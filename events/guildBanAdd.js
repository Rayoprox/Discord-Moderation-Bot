const { Events, AuditLogEvent } = require('discord.js');

module.exports = {
    name: Events.GuildBanAdd,
    async execute(ban) {
        // La lógica de reanudación de timers de BAN temporal ya está cubierta por el comando /ban.js.
        // Este evento solo debe registrar baneos manuales.

        const db = ban.client.db;
        const guild = ban.guild;
        const user = ban.user;
        const currentTimestamp = Date.now();

        // 1. Esperamos un poco para asegurarnos de que el Audit Log se haya actualizado
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 2. Buscamos en el Registro de Auditoría la última acción de baneo
        const fetchedLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberBanAdd,
        });

        const banLog = fetchedLogs.entries.first();

        // Si no se encuentra un log, o el objetivo no coincide, no podemos hacer nada
        if (!banLog || banLog.target.id !== user.id) {
            console.log(`[AUDIT LOG] Ban for ${user.tag} occurred, but no corresponding audit log entry was found. Ignoring.`);
            return;
        }

        const { executor, reason } = banLog;
        
        // --- 3. EXCLUSIÓN CRUCIAL MEJORADA ---
        // Primero, y más importante: si el autor del baneo (executor) es el propio bot,
        // SIEMPRE ignoramos el evento. Esta comprobación es inmediata y soluciona el problema de duplicación.
        if (executor.id === ban.client.user.id) {
            console.log(`[AUDIT LOG] Ban for ${user.tag} ignored (Initiated by the bot).`);
            return;
        }

        // Como una segunda capa de seguridad, revisamos si la razón contiene la marca [CMD].
        // Esto evita que se procese si, por alguna razón, el Audit Log se actualiza rápido.
        const finalReason = (reason || '').trim();
        if (finalReason.includes('[CMD]')) {
            console.log(`[AUDIT LOG] Ban for ${user.tag} ignored (Reason contains command flag).`);
            return;
        }

        // Si llegamos aquí, fue un baneo manual de Discord ejecutado por un humano.
        const cleanExecutorTag = executor.tag.trim();
        const cleanUserTag = user.tag.trim();
        
        console.log(`[INFO] Manual ban of ${cleanUserTag} by ${cleanExecutorTag} detected.`);

        const caseId = `MANUAL-${currentTimestamp}`;
        const endsAt = null;
        const isAppealable = 1; 
        const dmStatus = 'N/A'; // N/A porque no hay DM de notificación para bans manuales

        // POSTGRESQL: INSERT - Registramos el baneo manual
        await db.query(`
            INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, endsAt, appealable, dmstatus, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
            caseId, guild.id, 'BAN', user.id, cleanUserTag, executor.id, cleanExecutorTag, 
            finalReason, currentTimestamp, endsAt, isAppealable, dmStatus, 'PERMANENT'
        ]);
        
        console.log(`[INFO] Created database entry for manual ban. Case ID: ${caseId}`);
        // No enviamos DM, pues es un baneo manual y no tenemos los detalles de appeal.
    },
};