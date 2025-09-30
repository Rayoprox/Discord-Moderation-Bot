const { Events } = require('discord.js');

module.exports = {
    name: Events.GuildBanRemove,
    async execute(ban) {
        const db = ban.client.db;
        const userId = ban.user.id;
        const guildId = ban.guild.id;

        try {
            // --- AÑADIDO: LIMPIEZA DE TIMERS EN EL EVENTO ---
            const activeBansResult = await db.query(`SELECT caseid FROM modlogs WHERE guildid = $1 AND userid = $2 AND status = 'ACTIVE' AND action = 'BAN'`, [guildId, userId]);
            for (const row of activeBansResult.rows) {
                if (ban.client.punishmentTimers && ban.client.punishmentTimers.has(row.caseid)) {
                    clearTimeout(ban.client.punishmentTimers.get(row.caseid));
                    ban.client.punishmentTimers.delete(row.caseid);
                    console.log(`[TIMER] Cleared active timer for Case ID ${row.caseid} due to manual unban event.`);
                }
            }
            // --- FIN DE LA MODIFICACIÓN ---

            const result = await db.query(
                `UPDATE modlogs 
                 SET status = $1, "endsat" = NULL
                 WHERE userid = $2 
                   AND guildid = $3 
                   AND action = $4 
                   AND status = $5`, 
                ['EXPIRED', userId, guildId, 'BAN', 'ACTIVE']
            );
            
            if (result.rowCount > 0) {
                 console.log(`[INFO] Ban log for ${ban.user.tag} in ${ban.guild.name} marked as EXPIRED (Rows updated: ${result.rowCount}).`);
            }
            
        } catch (error) {
            console.error(`[ERROR] Failed to update ban status in DB (Guild ID: ${guildId}, User ID: ${userId}):`, error.message);
        }
    },
};