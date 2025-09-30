console.log(`--- BOT STARTING UP at ${new Date().toISOString()} ---`); // <--- FUNCIÓN DE DIAGNÓSTICO AÑADIDA

const { Client, Collection, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./utils/db.js'); // Assuming db.js is in the utils folder

// NO MÁS CLASE: Importamos las funciones directamente (necesario si las usas en algún otro lugar de index.js)
// Ya no es necesario importar aquí si solo se usan en ready.js, pero lo mantendremos por seguridad estructural.
const { startScheduler, resumePunishmentsOnStart } = require('./utils/temporary_punishment_handler.js'); 

// RENDER 24/7 HEARTBEAT REQUIREMENT
const http = require('http');

// Load environment variables (Make sure you upload all these to Render secrets)
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildBans
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.User]
});

client.commands = new Collection();
client.db = db; // Attach the database client to the Discord client

// --- COMMAND LOADING ---
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

// --- EVENT LOADING ---
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        // Para interactionCreate (y otros eventos), solo pasamos los argumentos estándar.
        client.on(event.name, (...args) => event.execute(...args)); 
    }
}

// --- DATABASE CONNECTION & BOT LOGIN ---
(async () => {
    try {
        await db.ensureTables();
        console.log('✅ All tables ensured in PostgreSQL.');
        
        // Login Discord bot after database is ready
        client.login(process.env.DISCORD_TOKEN);

    } catch (error) {
        console.error('❌ Failed to connect to database or login to Discord:', error);
    }
})();


// --- ELIMINADO: INITIALIZE TEMPORARY PUNISHMENT HANDLER ---
// La lógica de client.once('ready', ...) ha sido movida a events/ready.js


// --- RENDER 24/7 HEARTBEAT SERVER ---
const PORT = process.env.PORT || 3000; 

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is Awake and Live!');
});

server.listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT} for 24/7 heartbeat.`);
});