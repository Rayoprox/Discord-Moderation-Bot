const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const mainGuildCommands = [];
const appealGuildCommands = [];
const globalCommands = []; // Nueva categoría para comandos globales

const commandFolders = fs.readdirSync(path.join(__dirname, 'commands'));

for (const folder of commandFolders) {
    const commandFiles = fs.readdirSync(path.join(__dirname, 'commands', folder)).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(path.join(__dirname, 'commands', folder, file));
        if ('data' in command && 'execute' in command) {
            // Clasifica el comando según su etiqueta "deploy"
            switch (command.deploy) {
                case 'main':
                    mainGuildCommands.push(command.data.toJSON());
                    break;
                case 'appeal':
                    appealGuildCommands.push(command.data.toJSON());
                    break;
                case 'all': // Nueva opción para comandos globales
                    globalCommands.push(command.data.toJSON());
                    break;
                default:
                    console.warn(`[WARNING] The command ${command.data.name} is missing a "deploy" property.`);
                    break;
            }
        }
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        // Servidor PRINCIPAL
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: mainGuildCommands },
        );
        console.log(`Successfully reloaded ${mainGuildCommands.length} commands for the MAIN guild.`);

        // Servidor DE APELACIONES
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_APPEAL_GUILD_ID),
            { body: appealGuildCommands },
        );
        console.log(`Successfully reloaded ${appealGuildCommands.length} commands for the APPEAL guild.`);

        // Comandos GLOBALES (para todos los servidores)
        // Nota: Los comandos globales pueden tardar hasta 1 hora en aparecer.
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: globalCommands },
        );
        console.log(`Successfully reloaded ${globalCommands.length} GLOBAL commands.`);

    } catch (error) {
        console.error(error);
    }
})();