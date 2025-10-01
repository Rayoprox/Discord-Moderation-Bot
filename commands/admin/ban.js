const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const ms = require('ms');

const { resumePunishmentsOnStart } = require('../../utils/temporary_punishment_handler.js');

const APPEAL_SERVER_INVITE = process.env.DISCORD_APPEAL_INVITE_LINK;
const BAN_COLOR = 0xAA0000;
const SUCCESS_COLOR = 0x00FF00;

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a member from the server.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers) 
        .addUserOption(option => option.setName('user').setDescription('The user to ban (mention or ID).').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the ban.'))
        .addStringOption(option => option.setName('duration').setDescription('Duration of the ban (e.g., 7d, 2h, 30m). Permanent if omitted.'))
        .addStringOption(option => option.setName('delete_messages').setDescription('Delete messages from the banned user.').addChoices(
            { name: 'Don\'t delete', value: '0' }, { name: 'Last hour', value: '3600' },
            { name: 'Last 24 hours', value: '86400' }, { name: 'Last 7 days', value: '604800' }
        ))
        .addBooleanOption(option => option.setName('blacklist').setDescription('Immediately blacklist the user from appealing this ban (default: No).')),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const timeStr = interaction.options.getString('duration');
        const deleteMessageSeconds = parseInt(interaction.options.getString('delete_messages') || '0', 10);
        const shouldBlacklist = interaction.options.getBoolean('blacklist') ?? false;
        const isAppealable = !shouldBlacklist;
        const moderatorMember = interaction.member;
        const guildId = interaction.guild.id;
        const moderatorTag = interaction.user.tag;
        
        const cleanModeratorTag = moderatorTag.trim();
        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();
        
        // --- VERIFICACIONES (Usan editReply) ---
        if (targetUser.id === interaction.user.id) return interaction.editReply({ content: '❌ You cannot ban yourself.', flags: [MessageFlags.Ephemeral] });
        if (targetUser.id === interaction.client.user.id) return interaction.editReply({ content: '❌ You cannot ban me.', flags: [MessageFlags.Ephemeral] });
        if (targetUser.id === interaction.guild.ownerId) return interaction.editReply({ content: '❌ You cannot ban the server owner.', flags: [MessageFlags.Ephemeral] });

        // --- AÑADIDO: VERIFICACIÓN DE BAN EXISTENTE ---
        const isBanned = await interaction.guild.bans.fetch(targetUser.id).catch(() => null);
        if (isBanned) {
            return interaction.editReply({ content: '❌ This user is already banned.', flags: [MessageFlags.Ephemeral] });
        }
        // --- FIN DE LA MODIFICACIÓN ---

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (targetMember) {
            const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
            const guildSettings = guildSettingsResult.rows[0];
            
            const staffIds = guildSettings?.staff_roles ? guildSettings.staff_roles.split(',') : [];
            if (targetMember.roles.cache.some(r => staffIds.includes(r.id))) return interaction.editReply({ content: '❌ You cannot moderate a staff member.', flags: [MessageFlags.Ephemeral] });
            if (moderatorMember.roles.highest.position <= targetMember.roles.highest.position) return interaction.editReply({ content: '❌ You cannot ban a user with a role equal to or higher than your own.', flags: [MessageFlags.Ephemeral] });
            if (!targetMember.bannable) return interaction.editReply({ content: '❌ I do not have permission to ban this user (their role is likely higher than mine).', flags: [MessageFlags.Ephemeral] });
        }
        
        let endsAt = null;
        let durationStrDisplay = 'Permanent';
        let dbDurationStr = null; 

        if (timeStr) {
            const durationMs = ms(timeStr);
            if (typeof durationMs !== 'number' || durationMs <= 0) return interaction.editReply({ content: '❌ Invalid duration format.', flags: [MessageFlags.Ephemeral] });
            
            endsAt = currentTimestamp + durationMs; 
            durationStrDisplay = timeStr;
            dbDurationStr = timeStr; 
        }

        const caseId = `CASE-${currentTimestamp}`;
        
        let dmSent = false; 
        const dmEmbed = new EmbedBuilder()
            .setColor(BAN_COLOR)
            .setTitle(`🚨 Ban from ${interaction.guild.name} 🚨`)
            .setDescription(`We regret to inform you that you have been **banned** from the server **${interaction.guild.name}**.`)
            .setThumbnail(interaction.guild.iconURL({ dynamic: true, size: 128 }))
            .addFields(
                { name: '🛡️ Moderator', value: `${cleanModeratorTag}`, inline: true },
                { name: '⏳ Duration', value: durationStrDisplay, inline: true },
                { name: '📝 Reason', value: `\`\`\`\n${cleanReason}\n\`\`\``, inline: false }
            )
            .setTimestamp()
        
        if (isAppealable) {
            dmEmbed.setFooter({ text: `Case ID: ${caseId} | You will need this if you decide to appeal! 🧾` });
            if (!APPEAL_SERVER_INVITE.includes('TU_INVITACION_AQUI')) {
                dmEmbed.addFields({
                    name: '🗣️ How to Appeal',
                    value: `If you believe this was an error, you can submit an appeal by joining our appeals server: \n[**Click here to appeal**](${APPEAL_SERVER_INVITE})`
                });
            } else {
                 console.warn("[WARN] Appeal server invite link is not set in ban.js. No appeal info will be sent.");
            }
        } else {
            dmEmbed.setFooter({ text: `Case ID: ${caseId} | This punishment is NOT appealable. 🚫` });
            dmEmbed.addFields({ name: '🚫 Appeal Status', value: 'Your punishment has been **blacklisted** and cannot be appealed.' });
        }

        try {
            const dmChannel = await targetUser.createDM().catch(() => null);
            if (dmChannel) {
                await dmChannel.send({ embeds: [dmEmbed] });
                dmSent = true; 
            }
        } catch (error) {
            dmSent = false; 
            console.warn(`[WARN] Could not send DM to ${targetUser.tag}. Error: ${error.message.substring(0, 50)}...`);
        }

        try {
            const banReason = `[CMD] ${cleanReason} (Moderator: ${cleanModeratorTag}, Case ID: ${caseId})`;
            await interaction.guild.bans.create(targetUser.id, { reason: banReason, deleteMessageSeconds });
        } catch (error) {
            console.error('[ERROR] Failed to execute ban:', error);
            return interaction.editReply({ content: '❌ An unexpected error occurred while trying to ban the user.', flags: [MessageFlags.Ephemeral] });
        }

        await db.query(`
            INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, endsAt, action_duration, appealable, dmstatus, status) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
            caseId, guildId, 'BAN', targetUser.id, targetUser.tag, 
            interaction.user.id, cleanModeratorTag, cleanReason, currentTimestamp, 
            endsAt, dbDurationStr, isAppealable ? 1 : 0, dmSent ? 'SENT' : 'FAILED', endsAt ? 'ACTIVE' : 'PERMANENT'
        ]);

        if (endsAt) {
            resumePunishmentsOnStart(interaction.client); 
        }
        
        if (shouldBlacklist) {
            await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [targetUser.id, guildId]);
        }

        const modLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [guildId, 'modlog']);
        const modLogChannelId = modLogResult.rows[0]?.channel_id;
        
        if (modLogChannelId) {
            const channel = interaction.guild.channels.cache.get(modLogChannelId);
            if (channel) {
                const modLogEmbed = new EmbedBuilder()
                    .setColor(BAN_COLOR)
                    .setAuthor({ name: `${targetUser.tag} has been BANNED`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                    .addFields(
                        { name: '👤 User', value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true },
                        { name: '👮 Moderator', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                        { name: '⏳ Duration', value: durationStrDisplay, inline: true },
                        { name: '📝 Reason', value: cleanReason, inline: false },
                        { name: '✉️ DM Sent', value: dmSent ? '✅ Yes' : '❌ No/Failed', inline: true }, 
                        { name: '🗑️ Msgs Deleted', value: deleteMessageSeconds > 0 ? `${deleteMessageSeconds}s` : 'None', inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: `Case ID: ${caseId} | Appealable: ${isAppealable ? 'Yes' : 'No'}` });
                    
                const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(e => console.error(`[ERROR] Failed to send modlog for ban: ${e}`));
                
                if (sentMessage) {
                    await db.query('UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2', [sentMessage.id, caseId]);
                }
            }
        }
        
        const publicEmbed = new EmbedBuilder()
            .setColor(SUCCESS_COLOR) 
            .setTitle('🔨 Ban Successfully Executed')
            .setDescription(`The user **${targetUser.tag}** has been **banned** from the server.`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
            .addFields(
                { name: '👥 User', value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true },
                { name: '👮 Moderator', value: `<@${interaction.user.id}>`, inline: true },
                { name: '⏱️ Duration', value: durationStrDisplay, inline: true },
                { name: '🧾 Case ID', value: `\`${caseId}\``, inline: true },
                { name: '✉️ DM Status', value: dmSent ? '✅ Sent' : '❌ Failed', inline: true },
                { name: '🗣️ Appealable', value: isAppealable ? '✅ Yes' : '❌ No', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `Reason: ${cleanReason.substring(0, 50)}${cleanReason.length > 50 ? '...' : ''}` });

        await interaction.editReply({ embeds: [publicEmbed] });
    },
};