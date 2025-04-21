
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events } = require('discord.js');
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

// Команды
const commands = [
    new SlashCommandBuilder().setName('пидордня').setDescription('Вступить в игру'),
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

// Регистрация с удалением старых команд
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

// Клиент
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', () => {
    console.log(`🤖 Вошёл как ${client.user.tag}`);
});

// Обработка взаимодействий
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const nickname = interaction.member?.nickname || username;

    if (interaction.commandName === 'пидоралертс') {
        const channel = interaction.options.getChannel('канал');
        db.run("INSERT OR REPLACE INTO settings (discord_guild_id, channel_id) VALUES (?, ?)", [guildId, channel.id]);
        interaction.reply(`✅ Канал для анонсов установлен: ${channel}`);
    }
    // Остальные команды (пидордня, ктопидор, пидоргода и т.п.) опущены для краткости
});

client.login(process.env.TOKEN);