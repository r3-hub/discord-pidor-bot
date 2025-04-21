require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Collection, Events } = require('discord.js');
const sqlite3 = require('sqlite3');
const fs = require('fs');

// Инициализация базы
const db = new sqlite3.Database('database.db3');
db.run(`CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT,
    discord_user_name TEXT,
    discord_guild_id TEXT,
    score INTEGER DEFAULT 0
)`);
db.run(`CREATE TABLE IF NOT EXISTS settings (discord_guild_id TEXT PRIMARY KEY, channel_id TEXT)`);

db.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_guild_id TEXT,
    datetime INTEGER,
    winner_participant_id INTEGER
)`);

// Команды
const commands = [
    new SlashCommandBuilder().setName('пидордня').setDescription('Вступить в игру'),
    new SlashCommandBuilder().setName('ктопидор').setDescription('Выбрать пидора дня'),
    new SlashCommandBuilder().setName('топпидоров').setDescription('Показать рейтинг'),
    new SlashCommandBuilder()
        .setName('исключить')
        .setDescription('Удалить участника по ID (только для админа)')
        .addStringOption(opt =>
            opt.setName('id')
                .setDescription('ID или @пользователь')
                .setRequired(true)
        ),

    new SlashCommandBuilder().setName('пидоргода').setDescription('Показать пидора года'),
    new SlashCommandBuilder().setName('пидормесяца').setDescription('Показать пидора месяца'),
new SlashCommandBuilder()
        .setName('пидоралертс')
        .setDescription('Установить канал для автообъявлений пидора месяца')
        .addChannelOption(opt =>
            opt.setName('канал')
                .setDescription('Канал, куда писать пидора месяца')
                .setRequired(true)
        ),
].map(cmd => cmd.toJSON());

// Регистрация команд
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
    try {
        console.log('📦 Регистрирую команды...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Команды зарегистрированы!');
    } catch (err) {
        console.error(err);
    }
})();

// Создание клиента
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', () => {
    console.log(`🤖 Вошёл как ${client.user.tag}`);
// Автоматическая рассылка 1 числа и 31 декабря
setInterval(() => {
    const now = new Date();
    if (now.getDate() !== 1 && !(now.getMonth() === 11 && now.getDate() === 31)) return;

    if (now.getMonth() === 11 && now.getDate() === 31) {
        const year = now.getFullYear();
        const getTs = (y, m) => Math.floor(new Date(`${y}-${m.toString().padStart(2, '0')}-01`).getTime() / 1000);

        db.all("SELECT * FROM settings", [], (err, settingsRows) => {
            settingsRows.forEach(setting => {
                const guildId = setting.discord_guild_id;
                const channelId = setting.channel_id;

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
                        LIMIT 1`,
                        [guildId, fromTs, toTs], (err, rows) => {
                        if (rows && rows.length) {
                            const winner = rows[0].discord_user_name;
                            if (!monthWinners[winner]) monthWinners[winner] = 0;
                            monthWinners[winner]++;
                        }

                        pending--;
                        if (pending === 0) {
                            const entries = Object.entries(monthWinners);
                            if (!entries.length) return;
                            entries.sort((a, b) => b[1] - a[1]);
                            const [winner, count] = entries[0];
                            const channel = client.channels.cache.get(channelId);
                            if (channel) {
                                channel.send(`👑 Пидор ${year} года — ${winner} (побеждал ${count} месяц${count === 1 ? '' : count < 5 ? 'а' : 'ев'} из 12)`);
                            }
                        }
                    });
                }
            });
        });
    }


    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const fromTs = Math.floor(new Date(`${year}-${month}-01`).getTime() / 1000);
    const toTs = Math.floor(new Date(`${year}-${(parseInt(month) + 1).toString().padStart(2, '0')}-01`).getTime() / 1000);

    db.all("SELECT * FROM settings", [], (err, settingsRows) => {
        settingsRows.forEach(setting => {
            const guildId = setting.discord_guild_id;
            const channelId = setting.channel_id;
            db.all(`
                SELECT p.discord_user_name, COUNT(*) AS wins
                FROM games g
                JOIN participants p ON p.id = g.winner_participant_id
                WHERE g.discord_guild_id = ? AND g.datetime BETWEEN ? AND ?
                GROUP BY p.discord_user_name
                ORDER BY wins DESC
                LIMIT 1`,
                [guildId, fromTs, toTs], (err, rows) => {
                if (rows && rows.length) {
                    const top = rows[0];
                    const monthNames = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
                    const channel = client.channels.cache.get(channelId);
                    if (channel) {
                        channel.send(`🌟 Пидор ${monthNames[parseInt(month)-1]} — ${top.discord_user_name} (${top.wins} побед)!`);
                    }
                }
            });
        });
    });
}, 1000 * 60 * 60); // раз в час

});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const nickname = interaction.member?.nickname || username;

    if (interaction.commandName === 'пидордня') {
        db.get("SELECT * FROM participants WHERE discord_user_id = ? AND discord_guild_id = ?", [userId, guildId], (err, row) => {
            if (row) {
                interaction.reply({ content: "Ты уже участвуешь!", flags: 64 });
            } else {
                db.run("INSERT INTO participants (discord_user_id, discord_user_name, discord_guild_id) VALUES (?, ?, ?)", [userId, nickname, guildId]);
                interaction.reply("✅ Ты вступил в игру!");
            }
        });
    }

    if (interaction.commandName === 'ктопидор') {
        const now = Math.floor(Date.now() / 1000);
        db.get("SELECT g.datetime, p.discord_user_name FROM games g JOIN participants p ON p.id = g.winner_participant_id WHERE g.discord_guild_id = ? ORDER BY datetime DESC LIMIT 1", [guildId], (err, row) => {
            if (row && (now - row.datetime < 86400)) {
                interaction.reply(`📅 Сегодня уже выбран пидор: ${row.discord_user_name}`);
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

    if (interaction.commandName === 'исключить') {
        const adminId = "207169330549358592"; // можно поменять на свой Discord ID
        if (userId !== adminId) {
            interaction.reply({ content: "🚫 Нет доступа.", flags: 64 });
            return;
        }

        const rawId = interaction.options.getString('id');
        const cleanedId = rawId.replace(/[<@!>]/g, '');
        db.run("DELETE FROM participants WHERE discord_user_id = ? AND discord_guild_id = ?", [cleanedId, guildId]);
        interaction.reply("🗑 Участник исключён.");
    }
});

client.login(process.env.TOKEN);


client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');

        
    if (interaction.commandName === 'пидоргода') {
        const monthWinners = {};
        const year = new Date().getFullYear();

        const getTs = (y, m) => Math.floor(new Date(`${y}-${m.toString().padStart(2, '0')}-01`).getTime() / 1000);

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
            `, [guildId, fromTs, toTs], (err, rows) => {
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

    
    if (interaction.commandName === 'пидоралертс') {
        const channel = interaction.options.getChannel('канал');
        db.run("INSERT OR REPLACE INTO settings (discord_guild_id, channel_id) VALUES (?, ?)", [guildId, channel.id]);
        interaction.reply(`✅ Канал для анонсов установлен: ${channel}`);
    }

    if (interaction.commandName === 'пидормесяца') {
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
        `, [guildId, fromTs, toTs], (err, rows) => {
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
