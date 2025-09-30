// events/ready.js

const { Events } = require('discord.js');
// Asegúrate de que la ruta a tu utils sea correcta (normalmente un nivel de subida)
const { startScheduler, resumePunishmentsOnStart } = require('../utils/temporary_punishment_handler.js'); 

module.exports = {
    name: Events.ClientReady, 
    once: true, 
    async execute(client) {
        // 1. Inicialización de la bandera de control
        client.schedulerStarted = false; 
        
        // Log básico de conexión
        console.log(`Ready! Logged in as ${client.user.tag}`);
        
        // 2. Reanudar castigos pendientes
        const resumedCount = await resumePunishmentsOnStart(client);
        
        // 3. Iniciar el scheduler periódico
        startScheduler(client);
        
        // 4. Log final para confirmar que todo se inició UNA SOLA VEZ
        console.log(`[INFO] Completed timer resumption process. Total resumed: ${resumedCount}.`);
    }
};