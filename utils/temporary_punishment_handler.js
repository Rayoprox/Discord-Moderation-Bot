const ms = require('ms');
const { EmbedBuilder, Collection } = require('discord.js');

function initializeTimerMap(client) {
    if (!client.punishmentTimers) {
        client.punishmentTimers = new Collection();
    }
}

const processExpiredPunishment = async (client, log) => {
    initializeTimerMap(client);
    const db = client.db;
    const guild = client.guilds.cache.get(log.guildid);
    if (!guild) return;
    
    const activeCheck = await db.query('SELECT status FROM modlogs WHERE caseid = $1', [log.caseid]);
    if (activeCheck.rows.length === 0 || activeCheck.rows[0].status !== 'ACTIVE') {
         console.log(`[SCHEDULER] Log ${log.caseid} was already processed or is no longer active. Skipping.`);
         return; 
    }

    const action = log.action;
    const userId = log.userid;
    const caseId = log.caseid;
    const reason = `${action} expired (Auto-Lift)`;
    const currentTimestamp = Date.now();

    try {
        if (action === 'BAN') {
            await guild.bans.remove(userId, reason).catch(() => {});
        } else if (action === 'TIMEOUT') {
             const member = await guild.members.fetch(userId).catch(() => null);
             if (member && member.isCommunicationDisabled()) {
                 await member.timeout(null, reason).catch(() => {});
             }
        }
        
        await db.query(`UPDATE modlogs SET status = 'EXPIRED', "endsat" = NULL WHERE caseid = $1`, [caseId]);
        console.log(`[SCHEDULER] Auto-expired ${action} for ${log.usertag} (Case ID: ${caseId}).`);

        const logActionType = action === 'BAN' ? 'UNBAN' : 'UNMUTE';
        const autoCaseId = `AUTO-${logActionType}-${currentTimestamp}`;

        await db.query(`
            INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [autoCaseId, guild.id, logActionType, userId, log.usertag, client.user.id, client.user.tag, reason, currentTimestamp, 'EXECUTED']);
        
        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'modlog'", [guild.id]);
        const modLogChannelId = modLogResult.rows[0]?.channel_id;

        if (modLogChannelId) {
            const channel = guild.channels.cache.get(modLogChannelId);
            if (channel) {
                // --- ESTÉTICA MEJORADA: LOG DE EXPIRACIÓN AUTOMÁTICA ---
                 const user = await client.users.fetch(userId).catch(() => ({ tag: log.usertag, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' }));
                 const modLogEmbed = new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setAuthor({ name: `Punishment Expired: ${logActionType}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setDescription(`The temporary ${action.toLowerCase()} for **<@${userId}>** has expired.`)
                    .addFields(
                        { name: '👤 User', value: `<@${userId}> (\`${userId}\`)`, inline: true },
                        { name: '🤖 Moderator', value: `<@${client.user.id}>`, inline: true },
                        { name: '📝 Reason', value: `Automatic lift: Original punishment (\`${caseId}\`) has expired.`, inline: false }
                    )
                    .setFooter({ text: `Auto Case ID: ${autoCaseId}` })
                    .setTimestamp();
                 await channel.send({ embeds: [modLogEmbed] }).catch(console.error);
            }
        }
    } catch (error) {
        await db.query(`UPDATE modlogs SET status = 'EXPIRED', "endsat" = NULL WHERE caseid = $1`, [caseId]);
        console.warn(`[SCHEDULER] Failed to auto-lift ${action} for ${log.usertag}. Error: ${error.message}`);
    }
};


const resumePunishmentsOnStart = async (client) => {
    // Primero, procesamos los castigos que ya expiraron mientras el bot estaba offline.
    const db = client.db;
    const now = Date.now();
    const expiredResult = await db.query(`SELECT * FROM modlogs WHERE status = 'ACTIVE' AND "endsat" IS NOT NULL AND "endsat" <= $1`, [now]);
    for (const log of expiredResult.rows) {
        await processExpiredPunishment(client, log);
    }

    // Luego, reanudamos los timers para los que siguen activos.
    await checkAndResumePunishments(client);
    
    const logsResult = await db.query(`SELECT usertag, action, endsat, action_duration FROM modlogs WHERE status = 'ACTIVE' AND "endsat" IS NOT NULL ORDER BY "endsat" ASC`);
    
    if (logsResult.rows.length > 0) {
        console.log('\n--- ACTIVE TEMPORARY PUNISHMENTS ---');
        console.log(`Total Active Timers: ${logsResult.rows.length}`);
        for (const log of logsResult.rows) {
            const remaining = ms(Number(log.endsat) - Date.now(), { long: true });
            console.log(`[TIMER] ${log.action} | User: ${log.usertag} | Duration: ${log.action_duration || 'N/A'}`);
            console.log(`         > Time Left: ${remaining}`);
        }
        console.log('------------------------------------\n');
    }
};

const startScheduler = (client) => {
    if (client.schedulerStarted) {
        return;
    }
    client.schedulerStarted = true;
    // Este intervalo es una red de seguridad, por si algún setTimeout falla.
    setInterval(() => checkAndResumePunishments(client), ms('15m'));
};

module.exports = { startScheduler, resumePunishmentsOnStart, initializeTimerMap };