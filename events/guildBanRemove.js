const { Events } = require('discord.js');

module.exports = {
    name: Events.GuildBanRemove,
    async execute(ban) {
        const db = ban.client.db;
        const userId = ban.user.id;
        const guildId = ban.guild.id;

        // POSTGRESQL: Actualizar el log de BAN activo a EXPIRED (y limpiar endsAt)
        try {
            const result = await db.query(
                `UPDATE modlogs 
                 SET status = $1, endsAt = NULL
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