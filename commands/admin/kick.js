const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');

const KICK_COLOR = 0xE67E22; 
const SUCCESS_COLOR = 0x2ECC71; 

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kicks a member from the server.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to kick.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the kick.').setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const moderatorMember = interaction.member;
        const guildId = interaction.guild.id;

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        
        if (!targetMember) return interaction.editReply({ content: '❌ User is not in the server.', flags: [MessageFlags.Ephemeral] });
        if (targetUser.id === interaction.user.id) return interaction.editReply({ content: '❌ You cannot kick yourself.', flags: [MessageFlags.Ephemeral] });
        if (targetUser.id === interaction.client.user.id) return interaction.editReply({ content: '❌ You cannot kick me.', flags: [MessageFlags.Ephemeral] });
        if (targetUser.id === interaction.guild.ownerId) return interaction.editReply({ content: '❌ You cannot kick the server owner.', flags: [MessageFlags.Ephemeral] });
        
        const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
        const guildSettings = guildSettingsResult.rows[0];
        
        const staffIds = guildSettings?.staff_roles ? guildSettings.staff_roles.split(',') : [];
        if (targetMember.roles.cache.some(r => staffIds.includes(r.id))) return interaction.editReply({ content: '❌ You cannot moderate a staff member.', flags: [MessageFlags.Ephemeral] });
        if (moderatorMember.roles.highest.position <= targetMember.roles.highest.position) return interaction.editReply({ content: '❌ You cannot kick a user with a role equal to or higher than your own.', flags: [MessageFlags.Ephemeral] });
        if (!targetMember.kickable) return interaction.editReply({ content: '❌ I do not have permission to kick this user (their role is likely higher than mine).', flags: [MessageFlags.Ephemeral] });

        const caseId = `CASE-${Date.now()}`;
        const moderatorTag = interaction.user.tag;
        
        const cleanModeratorTag = moderatorTag.trim();
        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();
        let dmSent = false;
        
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor(KICK_COLOR) 
                .setTitle(`👢 You've Been Kicked from ${interaction.guild.name}`)
                .setDescription(`This is a notification that you have been **kicked**. You are free to rejoin if you have a valid invite.`)
                .addFields(
                    { name: '🛡️ Moderator', value: cleanModeratorTag, inline: true },
                    { name: '📝 Reason', value: `\`\`\`\n${cleanReason}\n\`\`\``, inline: false }
                )
                .setFooter({ text: `Case ID: ${caseId}` })
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] });
            dmSent = true;
        } catch (error) {
            dmSent = false;
            console.warn(`[WARN] Could not send DM to ${targetUser.tag}.`);
        }

        try {
            const kickReason = `[CMD] ${cleanReason} (Moderator: ${cleanModeratorTag}, Case ID: ${caseId})`;
            await targetMember.kick(kickReason);

            await db.query(`
                INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, appealable, status, dmstatus)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `, [caseId, guildId, 'KICK', targetUser.id, targetUser.tag, interaction.user.id, cleanModeratorTag, cleanReason, currentTimestamp, 0, 'EXECUTED', dmSent ? 'SENT' : 'FAILED']);

            const modLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [guildId, 'modlog']);
            const modLogChannelId = modLogResult.rows[0]?.channel_id;
            
            if (modLogChannelId) {
                const channel = interaction.guild.channels.cache.get(modLogChannelId);
                if (channel) {
                    const modLogEmbed = new EmbedBuilder()
                        .setColor(KICK_COLOR)
                        .setAuthor({ name: `${targetUser.tag} has been KICKED`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                        .addFields(
                            { name: '👤 User', value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true },
                            { name: '👮 Moderator', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                            { name: '📝 Reason', value: cleanReason, inline: false },
                            { name: '✉️ DM Sent', value: dmSent ? '✅ Yes' : '❌ No/Failed', inline: true }
                        )
                        .setFooter({ text: `Case ID: ${caseId}` })
                        .setTimestamp();
                    
                    const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(console.error);
                    if (sentMessage) {
                        await db.query('UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2', [sentMessage.id, caseId]);
                    }
                }
            }
            
            const publicEmbed = new EmbedBuilder()
                .setColor(SUCCESS_COLOR) 
                .setTitle('👢 Kick Successfully Executed')
                .setDescription(`The user **${targetUser.tag}** has been **kicked** from the server.`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
                .addFields(
                    { name: '👥 User', value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true },
                    { name: '👮 Moderator', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '🧾 Case ID', value: `\`${caseId}\``, inline: true },
                    { name: '✉️ DM Status', value: dmSent ? '✅ Sent' : '❌ Failed', inline: true }
                )
                .setTimestamp()
                .setFooter({ text: `Reason: ${cleanReason.substring(0, 50)}${cleanReason.length > 50 ? '...' : ''}` });
            
            await interaction.editReply({ embeds: [publicEmbed] }); 

        } catch (error) {
            console.error('[ERROR] Failed to execute kick:', error);
            return interaction.editReply({ content: '❌ An error occurred during the kick execution. Please check my permissions and role hierarchy.', flags: [MessageFlags.Ephemeral] });
        }
    },
};