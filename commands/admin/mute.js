const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const ms = require('ms');
const { resumePunishmentsOnStart } = require('../../utils/temporary_punishment_handler.js');

const MUTE_COLOR = 0xFFA500; 
const SUCCESS_COLOR = 0x2ECC71; 

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mutes a member for a specified duration (uses Timeout).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to mute.').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('Duration of the mute (e.g., 10m, 1h, 2d). Max: 28 days.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the mute.').setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const durationStr = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const moderatorMember = interaction.member;
        const guildId = interaction.guild.id;

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
            return interaction.editReply({ content: '❌ User is not in the server.', flags: [MessageFlags.Ephemeral] });
        }

        if (targetUser.id === interaction.user.id) return interaction.editReply({ content: '❌ You cannot mute yourself.', flags: [MessageFlags.Ephemeral] });
        if (targetUser.id === interaction.client.user.id) return interaction.editReply({ content: '❌ You cannot mute me.', flags: [MessageFlags.Ephemeral] });
        if (targetUser.id === interaction.guild.ownerId) return interaction.editReply({ content: '❌ You cannot mute the server owner.', flags: [MessageFlags.Ephemeral] });
        if (targetMember.isCommunicationDisabled()) return interaction.editReply({ content: '❌ This user is already muted.', flags: [MessageFlags.Ephemeral] });
        
        const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
        const guildSettings = guildSettingsResult.rows[0];
        
        const staffIds = guildSettings?.staff_roles ? guildSettings.staff_roles.split(',') : [];
        if (targetMember.roles.cache.some(r => staffIds.includes(r.id))) return interaction.editReply({ content: '❌ You cannot moderate a staff member.', flags: [MessageFlags.Ephemeral] });
        if (moderatorMember.roles.highest.position <= targetMember.roles.highest.position) return interaction.editReply({ content: '❌ You cannot mute a user with a role equal to or higher than your own.', flags: [MessageFlags.Ephemeral] });
        
        let durationMs;
        try {
            durationMs = ms(durationStr);
        } catch (e) {
            return interaction.editReply({ content: '❌ Invalid duration format. Use formats like "10m", "1h", "2d".', flags: [MessageFlags.Ephemeral] });
        }

        if (!durationMs || durationMs < 5000 || durationMs > 2419200000) { // 5 seconds to 28 days
            return interaction.editReply({ content: '❌ Duration must be between 5 seconds and 28 days.', flags: [MessageFlags.Ephemeral] });
        }

        const endsAt = Date.now() + durationMs;
        const caseId = `CASE-${Date.now()}`;
        const moderatorTag = interaction.user.tag;
        
        const cleanModeratorTag = moderatorTag.trim();
        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();

        let dmSent = false;
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor(MUTE_COLOR)
                .setTitle(`🤫 You've Been Timed Out in ${interaction.guild.name}`)
                .setDescription(`Your communication privileges have been restricted due to a moderation action.`)
                .setThumbnail(interaction.guild.iconURL({ dynamic: true, size: 128 }))
                .addFields(
                    { name: '⏳ Duration', value: durationStr, inline: true },
                    { name: '🛡️ Moderator', value: cleanModeratorTag, inline: true },
                    { name: '📝 Reason', value: `\`\`\`\n${cleanReason}\n\`\`\``, inline: false }
                )
                .setFooter({ text: `Case ID: ${caseId} | Time ends:` })
                .setTimestamp(endsAt);
            await targetUser.send({ embeds: [dmEmbed] });
            dmSent = true;
        } catch (error) {
            dmSent = false;
            console.warn(`[WARN] Could not send DM to ${targetUser.tag}.`);
        }

        try {
            await targetMember.timeout(durationMs, `[CMD] ${cleanReason} (Moderator: ${cleanModeratorTag})`);
        } catch (error) {
            console.error('[ERROR] Failed to execute timeout:', error);
            return interaction.editReply({ content: '❌ An error occurred. Please check my permissions and role hierarchy.', flags: [MessageFlags.Ephemeral] });
        }

        await db.query(`
            INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, endsAt, action_duration, status, dmstatus)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
            caseId, guildId, 'TIMEOUT', targetUser.id, targetUser.tag, 
            interaction.user.id, cleanModeratorTag, cleanReason, currentTimestamp, endsAt, durationStr, 'ACTIVE', dmSent ? 'SENT' : 'FAILED'
        ]);

        resumePunishmentsOnStart(interaction.client); 

        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2", [guildId, 'modlog']);
        const modLogChannelId = modLogResult.rows[0]?.channel_id;

        if (modLogChannelId) {
            const channel = interaction.guild.channels.cache.get(modLogChannelId);
            if(channel) {
                const modLogEmbed = new EmbedBuilder()
                    .setColor(MUTE_COLOR)
                    .setAuthor({ name: `${targetUser.tag} has been MUTED`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                    .addFields(
                        { name: '👤 User', value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true }, 
                        { name: '👮 Moderator', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                        { name: '⏳ Duration', value: durationStr, inline: true }, 
                        { name: '📝 Reason', value: cleanReason, inline: false }, 
                        { name: '✉️ DM Sent', value: dmSent ? '✅ Yes' : '❌ No/Failed', inline: true }
                    )
                    .setFooter({ text: `Case ID: ${caseId}` })
                    .setTimestamp();
                
                const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(console.error);
                
                if (sentMessage) {
                    await db.query("UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2", [sentMessage.id, caseId]);
                }
            }
        }
        
        const publicEmbed = new EmbedBuilder()
            .setColor(SUCCESS_COLOR) 
            .setTitle('✅ Mute Successfully Applied')
            .setDescription(`**${targetUser.tag}** has been **timed out** successfully.`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
            .addFields(
                { name: '👮 Moderator', value: `<@${interaction.user.id}>`, inline: true }, 
                { name: '⏱️ Duration', value: durationStr, inline: true }, 
                { name: '🧾 Case ID', value: `\`${caseId}\``, inline: true },
                { name: '📝 Reason', value: cleanReason, inline: false }
            )
            .setFooter({ text: `Timeout ends:` })
            .setTimestamp(endsAt); 
        await interaction.editReply({ embeds: [publicEmbed] });
    },
};