
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events } = require('discord.js');
const sqlite3 = require('sqlite3');
const fs = require('fs');

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

    if (interaction.commandName === 'пидоралертс') {
        const channel = interaction.options.getChannel('канал');
        db.run("INSERT OR REPLACE INTO settings (discord_guild_id, channel_id) VALUES (?, ?)", [guildId, channel.id]);
        interaction.reply(`✅ Канал для анонсов установлен: ${channel}`);
    }
    // Здесь могут быть другие команды (ктопидор, топпидоров и т.д.)
});

client.login(process.env.TOKEN);