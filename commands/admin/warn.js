const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const ms = require('ms');
const { resumePunishmentsOnStart } = require('../../utils/temporary_punishment_handler.js');

const WARN_COLOR = 0xFFD700;
const SUCCESS_COLOR = 0x2ECC71;
const AUTOMOD_COLOR = 0xAA0000;

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Issues a warning to a user.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to warn.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the warning.').setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const moderatorMember = interaction.member;
        const guildId = interaction.guild.id;
        const moderatorTag = interaction.user.tag;
        
        const cleanModeratorTag = moderatorTag.trim();
        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();

        if (targetUser.id === interaction.user.id) { return interaction.editReply({ content: '❌ You cannot warn yourself.', flags: [MessageFlags.Ephemeral] }); }
        if (targetUser.id === interaction.client.user.id) { return interaction.editReply({ content: '❌ You cannot warn me.', flags: [MessageFlags.Ephemeral] }); }
        if (targetUser.id === interaction.guild.ownerId) { return interaction.editReply({ content: '❌ You cannot warn the server owner.', flags: [MessageFlags.Ephemeral] }); }
        
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (targetMember) {
            const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
            const staffIds = guildSettingsResult.rows[0]?.staff_roles ? guildSettingsResult.rows[0].staff_roles.split(',') : [];
            if (targetMember.roles.cache.some(r => staffIds.includes(r.id))) { return interaction.editReply({ content: '❌ You cannot moderate a staff member.', flags: [MessageFlags.Ephemeral] }); }
            if (moderatorMember.roles.highest.position <= targetMember.roles.highest.position) { return interaction.editReply({ content: '❌ You cannot warn a user with a role equal to or higher than your own.', flags: [MessageFlags.Ephemeral] }); }
        }

        const caseId = `CASE-${currentTimestamp}`;
        
        let dmSent = false;
        try {
            const dmEmbed = new EmbedBuilder().setColor(WARN_COLOR).setTitle(`⚠️ Official Warning Issued in ${interaction.guild.name}`).setDescription(`This is an official warning regarding your recent conduct.`).addFields({ name: '🛡️ Moderator', value: cleanModeratorTag }, { name: '📝 Reason', value: `\`\`\`${cleanReason}\`\`\`` }).setFooter({ text: `Case ID: ${caseId}` }).setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] });
            dmSent = true;
        } catch (error) { console.warn(`[WARN] Could not send Manual Warn DM to ${targetUser.tag}.`); }

        await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status, dmstatus) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [caseId, guildId, 'WARN', targetUser.id, targetUser.tag, interaction.user.id, cleanModeratorTag, cleanReason, currentTimestamp, 'ACTIVE', dmSent ? 'SENT' : 'FAILED']);

        const countResult = await db.query("SELECT COUNT(*) as count FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'WARN' AND status = 'ACTIVE'", [targetUser.id, guildId]);
        const activeWarningsCount = Number(countResult.rows[0].count);

        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'modlog'", [guildId]);
        const modLogChannelId = modLogResult.rows[0]?.channel_id;
        const modLogChannel = modLogChannelId ? interaction.guild.channels.cache.get(modLogChannelId) : null;

        // --- ESTÉTICA MEJORADA: LOG DEL WARN ---
        if (modLogChannel) {
            const warnLogEmbed = new EmbedBuilder()
                .setColor(WARN_COLOR)
                .setAuthor({ name: `${targetUser.tag} has been WARNED`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                .addFields(
                    { name: '👤 User', value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true },
                    { name: '👮 Moderator', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                    { name: '⚠️ Active Warnings', value: `${activeWarningsCount}`, inline: true },
                    { name: '📝 Reason', value: cleanReason, inline: false },
                    { name: '✉️ DM Sent', value: dmSent ? '✅ Yes' : '❌ No/Failed', inline: true }
                )
                .setFooter({ text: `Case ID: ${caseId}` })
                .setTimestamp();
            
            const sent = await modLogChannel.send({ embeds: [warnLogEmbed] }).catch(console.error);
            if(sent) await db.query('UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2', [sent.id, caseId]);
        }

        let finalReplyEmbed;
        
        const ruleResult = await db.query('SELECT * FROM automod_rules WHERE guildid = $1 AND warnings_count = $2', [guildId, activeWarningsCount]);
        const ruleToExecute = ruleResult.rows[0];

       
        if (ruleToExecute && targetMember) {
            const action = ruleToExecute.action_type;
            const durationStr = ruleToExecute.action_duration;
            const autoCaseId = `AUTO-${Date.now()}`;
            const autoReason = `Automod: Triggered by reaching ${activeWarningsCount} warnings.`;
            let endsAt = null;
            let autoDmSent = false;

            try {
                const dmPunishmentEmbed = new EmbedBuilder().setColor(AUTOMOD_COLOR).setTitle(`🚨 Automated Action: ${action}`).setDescription(`Due to accumulating **${activeWarningsCount} active warnings**, an automated punishment has been applied in **${interaction.guild.name}**.`).addFields({ name: '🔨 Action', value: action, inline: true }, { name: '⏳ Duration', value: durationStr || (action === 'KICK' ? 'Instant' : 'Permanent'), inline: true }).setFooter({ text: `Case ID: ${autoCaseId}` });
                await targetUser.send({ embeds: [dmPunishmentEmbed] });
                autoDmSent = true;
            } catch (e) { console.warn(`[AUTOMOD] Could not send punishment DM to ${targetUser.tag}.`); }

           
            try {
                if ((action === 'MUTE' || action === 'BAN') && durationStr) {
                    const durationMs = ms(durationStr);
                    if (durationMs) endsAt = Date.now() + durationMs;
                }
const dbAction = action === 'MUTE' ? 'TIMEOUT' : action; // Estandarizamos 'MUTE' a 'TIMEOUT'
                
                await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, "endsat", action_duration, status, dmstatus) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [autoCaseId, guildId, dbAction, targetUser.id, targetUser.tag, interaction.client.user.id, interaction.client.user.tag, autoReason, Date.now(), endsAt, durationStr, 'ACTIVE', autoDmSent ? 'SENT' : 'FAILED']);
                
                if (endsAt) resumePunishmentsOnStart(interaction.client);
                
                if (action === 'KICK') await targetMember.kick(autoReason);
                else if (action === 'BAN') await interaction.guild.bans.create(targetUser.id, { reason: autoReason });
                else if (action === 'MUTE') {
                    const durationMs = ms(durationStr);
                    if (durationMs) await targetMember.timeout(durationMs, autoReason);
                }

                // --- ESTÉTICA MEJORADA: LOG DEL AUTOMOD ---
                if (modLogChannel) {
                    const punishmentLogEmbed = new EmbedBuilder()
                        .setColor(AUTOMOD_COLOR)
                        .setAuthor({ name: `${targetUser.tag} has been auto-${action.toLowerCase()}ed`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                        .addFields(
                            { name: '👤 User', value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true },
                            { name: '🤖 Moderator', value: `<@${interaction.client.user.id}>`, inline: true },
                            { name: '⏳ Duration', value: durationStr || 'Permanent', inline: true },
                            { name: '📝 Reason', value: autoReason, inline: false },
                            { name: '✉️ DM Sent', value: autoDmSent ? '✅ Yes' : '❌ No/Failed', inline: true }
                        )
                        .setFooter({ text: `Case ID: ${autoCaseId}` })
                        .setTimestamp();
                    
                    const sentAuto = await modLogChannel.send({ embeds: [punishmentLogEmbed] }).catch(console.error);
                    if(sentAuto) await db.query('UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2', [sentAuto.id, autoCaseId]);
                }

                // --- ESTÉTICA MEJORADA: RESPUESTA PÚBLICA DEL AUTOMOD ---
                finalReplyEmbed = new EmbedBuilder()
                    .setColor(AUTOMOD_COLOR)
                    .setTitle(`⚠️ Automod Triggered: ${action}`)
                    .setDescription(`**${targetUser.tag}** was warned, reaching **${activeWarningsCount}** warnings and triggering an automatic action.`)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
                    .addFields(
                        { name: '👮 Moderator (Warn)', value: `<@${interaction.user.id}>`, inline: true },
                        { name: '🤖 Punishment', value: `${action}`, inline: true },
                        { name: '⏳ Duration', value: durationStr || 'Permanent', inline: true },
                        { name: '🧾 Warn Case ID', value: `\`${caseId}\``, inline: false },
                        { name: '🧾 Automod Case ID', value: `\`${autoCaseId}\``, inline: false }
                    )
                    .setTimestamp();

            } catch (autoError) {
                console.error('[ERROR] AUTOMOD FAILED:', autoError);
                finalReplyEmbed = new EmbedBuilder().setColor(SUCCESS_COLOR).setTitle('✅ Warning Issued (Automod Failed)').setDescription(`**${targetUser.tag}** has been warned, but the automated punishment of **${action}** failed. Please check my permissions.`);
            }
        }

        // --- ESTÉTICA MEJORADA: RESPUESTA PÚBLICA DEL WARN ---
        if (!finalReplyEmbed) {
            finalReplyEmbed = new EmbedBuilder()
                .setColor(SUCCESS_COLOR)
                .setTitle('✅ Warning Successfully Issued')
                .setDescription(`**${targetUser.tag}** has been warned.`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
                .addFields(
                    { name: '👮 Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '⚠️ Active Warnings', value: `${activeWarningsCount}`, inline: true },
                    { name: '🧾 Case ID', value: `\`${caseId}\``, inline: true }
                )
                .setFooter({ text: `Reason: ${cleanReason.substring(0, 100)}${cleanReason.length > 100 ? '...' : ''}` })
                .setTimestamp();
        }
        
        await interaction.editReply({ embeds: [finalReplyEmbed] });
    },
};