
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events } = require('discord.js');
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('database.db3');

db.run(`CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT,
    discord_user_name TEXT,
    discord_guild_id TEXT,
    score INTEGER DEFAULT 0
)`);
db.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_guild_id TEXT,
    datetime INTEGER,
    winner_participant_id INTEGER
)`);
db.run(`CREATE TABLE IF NOT EXISTS settings (
    discord_guild_id TEXT PRIMARY KEY,
    channel_id TEXT
)`);

const commands = [
    new SlashCommandBuilder().setName('ктопидор').setDescription('Выбрать пидора дня'),
    new SlashCommandBuilder().setName('топпидоров').setDescription('Показать рейтинг'),
    new SlashCommandBuilder().setName('пидоргода').setDescription('Показать пидора года'),
    new SlashCommandBuilder().setName('пидормесяца').setDescription('Показать пидора месяца'),
    new SlashCommandBuilder()
        .setName('пидоралертс')
        .setDescription('Установить канал для автообъявлений пидора месяца')
        .addChannelOption(opt =>
            opt.setName('канал')
                .setDescription('Канал, куда писать пидора месяца')
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
    try {
        console.log('📦 Удаляю старые команды...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
        console.log('✅ Старые команды удалены');

        console.log('📦 Регистрирую новые команды...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Новые команды зарегистрированы!');
    } catch (err) {
        console.error(err);
    }
})();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', () => {
    console.log(`🤖 Вошёл как ${client.user.tag}`);
});

// Обновляем участников автоматически
async function ensureParticipants(guild) {
    const members = await guild.members.fetch();
    members.forEach(member => {
        if (!member.user.bot) {
            db.get("SELECT * FROM participants WHERE discord_user_id = ? AND discord_guild_id = ?", [member.user.id, guild.id], (err, row) => {
                if (!row) {
                    db.run("INSERT INTO participants (discord_user_id, discord_user_name, discord_guild_id) VALUES (?, ?, ?)", [member.user.id, member.displayName || member.user.username, guild.id]);
                }
            });
        }
    });
}

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const guildId = interaction.guild.id;

    await ensureParticipants(interaction.guild);

    if (interaction.commandName === 'ктопидор') {
        const now = Math.floor(Date.now() / 1000);
        db.get("SELECT g.datetime, p.discord_user_name FROM games g JOIN participants p ON p.id = g.winner_participant_id WHERE g.discord_guild_id = ? ORDER BY datetime DESC LIMIT 1", [guildId], (err, row) => {
            if (row && (now - row.datetime < 86400)) {
                interaction.reply(`📅 Сегодня уже был выбран пидор: ${row.discord_user_name}`);
                return;
            }
            db.all("SELECT * FROM participants WHERE discord_guild_id = ?", [guildId], (err, rows) => {
                if (!rows.length) {
                    interaction.reply("❌ Нет участников.");
                    return;
                }
                const winner = rows[Math.floor(Math.random() * rows.length)];
                db.run("INSERT INTO games (discord_guild_id, datetime, winner_participant_id) VALUES (?, ?, ?)", [guildId, now, winner.id]);
                db.run("UPDATE participants SET score = score + 1 WHERE id = ?", [winner.id]);
                interaction.reply(`🏆 Сегодняшний пидор дня: <@${winner.discord_user_id}>!`);
            });
        });
    }

    if (interaction.commandName === 'топпидоров') {
        db.all("SELECT discord_user_name, score FROM participants WHERE discord_guild_id = ? ORDER BY score DESC LIMIT 10", [guildId], (err, rows) => {
            if (!rows.length) {
                interaction.reply("👻 Нет статистики.");
                return;
            }
            const list = rows.map((u, i) => `**${i + 1}.** ${u.discord_user_name} — ${u.score}`).join("\n");
            interaction.reply("📊 Топ пидоров:\n" + list);
        });
    }

    if (interaction.commandName === 'пидоралертс') {
        const channel = interaction.options.getChannel('канал');
        db.run("INSERT OR REPLACE INTO settings (discord_guild_id, channel_id) VALUES (?, ?)", [guildId, channel.id]);
        interaction.reply(`✅ Канал для анонсов установлен: ${channel}`);
    }

    if (interaction.commandName === 'пидоргода') {
        const year = new Date().getFullYear();
        const getTs = (y, m) => Math.floor(new Date(`${y}-${m.toString().padStart(2, '0')}-01`).getTime() / 1000);
        const monthWinners = {};
        let pending = 0;
        for (let m = 1; m <= 12; m++) {
            pending++;
            const fromTs = getTs(year, m);
            const toTs = getTs(year, m + 1);
            db.all(`
                SELECT p.discord_user_name, COUNT(*) AS wins
                FROM games g
                JOIN participants p ON p.id = g.winner_participant_id
                WHERE g.discord_guild_id = ? AND g.datetime BETWEEN ? AND ?
                GROUP BY p.discord_user_name
                ORDER BY wins DESC
                LIMIT 1
                `,
                [guildId, fromTs, toTs], (err, rows) => {
                if (rows && rows.length) {
                    const winner = rows[0].discord_user_name;
                    if (!monthWinners[winner]) monthWinners[winner] = 0;
                    monthWinners[winner]++;
                }
                pending--;
                if (pending === 0) {
                    const entries = Object.entries(monthWinners);
                    if (!entries.length) {
                        interaction.reply("❌ В этом году ещё не было ни одного пидора месяца.");
                        return;
                    }
                    entries.sort((a, b) => b[1] - a[1]);
                    const [winner, count] = entries[0];
                    interaction.reply(`👑 Пидор ${year} года — ${winner} (побеждал ${count} месяц${count === 1 ? '' : count < 5 ? 'а' : 'ев'} из 12)`);
                }
            });
        }
    }

    if (interaction.commandName === 'пидормесяца') {
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const fromTs = Math.floor(new Date(`${year}-${month}-01`).getTime() / 1000);
        const toTs = Math.floor(new Date(`${year}-${(parseInt(month) + 1).toString().padStart(2, '0')}-01`).getTime() / 1000);
        db.all(`
            SELECT p.discord_user_name, COUNT(*) AS wins
            FROM games g
            JOIN participants p ON p.id = g.winner_participant_id
            WHERE g.discord_guild_id = ? AND g.datetime BETWEEN ? AND ?
            GROUP BY p.discord_user_name
            ORDER BY wins DESC
            LIMIT 1
            `,
            [guildId, fromTs, toTs], (err, rows) => {
            if (!rows || !rows.length) {
                interaction.reply("❌ В этом месяце ещё никто не был пидором.");
                return;
            }
            const top = rows[0];
            const monthNames = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
            interaction.reply(`🌟 Пидор ${monthNames[parseInt(month)-1]} — ${top.discord_user_name} (${top.wins} побед)!`);
        });
    }
});

client.login(process.env.TOKEN);
