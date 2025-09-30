const { Events, AuditLogEvent } = require('discord.js');
const { initializeTimerMap } = require('../utils/temporary_punishment_handler.js');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        initializeTimerMap(newMember.client);
        // Solo nos interesa cuando se quita un timeout
        if (oldMember.isCommunicationDisabled() && !newMember.isCommunicationDisabled()) {
            
            await new Promise(resolve => setTimeout(resolve, 1500)); // Esperar a que el Audit Log se actualice

            const fetchedLogs = await newMember.guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.MemberUpdate,
            });

            const log = fetchedLogs.entries.first();

            if (!log || log.target.id !== newMember.id || !log.changes.some(c => c.key === 'communication_disabled_until')) {
                return;
            }

            const { executor } = log;

            if (executor.id === newMember.client.user.id) {
                return;
            }

            console.log(`[INFO] Manual unmute of ${newMember.user.tag} by ${executor.tag} detected.`);
            
            const db = newMember.client.db;
            try {
                const activeTimeoutsResult = await db.query(
                    `SELECT caseid FROM modlogs WHERE guildid = $1 AND userid = $2 AND status = 'ACTIVE' AND action = 'TIMEOUT'`,
                    [newMember.guild.id, newMember.id]
                );

                for (const row of activeTimeoutsResult.rows) {
                    const caseId = row.caseid;
                    if (newMember.client.punishmentTimers && newMember.client.punishmentTimers.has(caseId)) {
                        clearTimeout(newMember.client.punishmentTimers.get(caseId));
                        newMember.client.punishmentTimers.delete(caseId);
                        console.log(`[TIMER] Cleared active timer for Case ID ${caseId} due to manual unmute.`);
                    }
                }
                
                const result = await db.query(
                    `UPDATE modlogs SET status = 'EXPIRED', "endsat" = NULL
                     WHERE guildid = $1 AND userid = $2 AND status = 'ACTIVE' AND action = 'TIMEOUT'`,
                    [newMember.guild.id, newMember.id]
                );
                
                if (result.rowCount > 0) {
                    console.log(`[INFO] Marked active timeout(s) as EXPIRED in DB for ${newMember.user.tag}.`);
                }
            } catch (error) {
                 console.error(`[ERROR] Failed to process manual unmute for ${newMember.user.tag}:`, error);
            }
        }
    },
};