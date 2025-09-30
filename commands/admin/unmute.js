const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const { initializeTimerMap } = require('../../utils/temporary_punishment_handler.js');

const UNMUTE_COLOR = 0x2ECC71;

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Removes a timeout from a user.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to unmute.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the unmute.').setRequired(false)),

    async execute(interaction) {
        initializeTimerMap(interaction.client);
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const guildId = interaction.guild.id;
        const moderatorTag = interaction.user.tag;
        
        const cleanModeratorTag = moderatorTag.trim();
        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
            return interaction.editReply({ content: '❌ User is not in the server.', flags: [MessageFlags.Ephemeral] });
        }

        if (!targetMember.isCommunicationDisabled()) {
            return interaction.editReply({ content: '❌ This user is not currently muted.', flags: [MessageFlags.Ephemeral] });
        }

        try {
            await targetMember.timeout(null, `Manually unmuted by ${moderatorTag}. Reason: ${cleanReason}`);
        } catch (error) {
            console.error('Failed to unmute user:', error);
            return interaction.editReply({ content: '❌ An error occurred. Please check my permissions and role hierarchy.', flags: [MessageFlags.Ephemeral] });
        }

        const activeTimeoutsResult = await db.query(`SELECT caseid FROM modlogs WHERE guildid = $1 AND userid = $2 AND status = 'ACTIVE' AND action = 'TIMEOUT'`, [guildId, targetUser.id]);
        for (const row of activeTimeoutsResult.rows) {
            if (interaction.client.punishmentTimers.has(row.caseid)) {
                clearTimeout(interaction.client.punishmentTimers.get(row.caseid));
                interaction.client.punishmentTimers.delete(row.caseid);
                console.log(`[TIMER] Cleared active timer for Case ID ${row.caseid} due to /unmute command.`);
            }
        }

        await db.query(`UPDATE modlogs SET status = 'EXPIRED', "endsat" = NULL WHERE guildid = $1 AND userid = $2 AND status = 'ACTIVE' AND action = 'TIMEOUT'`, [guildId, targetUser.id]);

        const unmuteCaseId = `CASE-${currentTimestamp}`;
        await db.query(`
            INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, appealable, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [unmuteCaseId, guildId, 'UNMUTE', targetUser.id, targetUser.tag, interaction.user.id, cleanModeratorTag, cleanReason, currentTimestamp, 0, 'EXECUTED']);

        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'modlog'", [guildId]);
        const modLogChannelId = modLogResult.rows[0]?.channel_id;
        
        if (modLogChannelId) {
            const channel = interaction.guild.channels.cache.get(modLogChannelId);
            if(channel){
                const modLogEmbed = new EmbedBuilder().setColor(UNMUTE_COLOR).setAuthor({ name: `${targetUser.tag} has been UNMUTED`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) }).addFields({ name: '👤 User', value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true },{ name: '👮 Moderator', value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },{ name: '📝 Reason', value: cleanReason, inline: false }).setFooter({ text: `Case ID: ${unmuteCaseId}` }).setTimestamp();
                const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(console.error);
                if (sentMessage) { await db.query("UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2", [sentMessage.id, unmuteCaseId]); }
            }
        }
        
        const publicEmbed = new EmbedBuilder().setColor(UNMUTE_COLOR).setTitle('✅ Unmute Successful').setDescription(`**${targetUser.tag}**'s communication privileges have been **restored**.`).addFields({ name: '👮 Moderator', value: `<@${interaction.user.id}>` },{ name: '📝 Reason', value: cleanReason }).setFooter({ text: `User ID: ${targetUser.id}` }).setTimestamp();
        
        await interaction.editReply({ embeds: [publicEmbed] });
    },
};