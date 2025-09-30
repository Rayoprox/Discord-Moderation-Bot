const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');

const UNBAN_COLOR = 0x2ECC71; 

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Removes a ban from a user.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('The ID of the user to unban.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the unban.')
                .setRequired(false)),

    async execute(interaction) {
        const targetId = interaction.options.getString('user_id');
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const guild = interaction.guild;
        const guildId = interaction.guild.id;

        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();

        if (!/^\d{17,19}$/.test(targetId)) {
            return interaction.editReply({ content: '❌ Please provide a valid user ID.', flags: [MessageFlags.Ephemeral] });
        }

        let ban;
        try {
            ban = await guild.bans.fetch(targetId);
        } catch (error) {
            if (error.code === 10026) {
                return interaction.editReply({ content: `❌ User with ID \`${targetId}\` is not banned from this server.`, flags: [MessageFlags.Ephemeral] });
            }
            console.error('Failed to fetch ban:', error);
            return interaction.editReply({ content: 'An unexpected error occurred while checking the ban list.', flags: [MessageFlags.Ephemeral] });
        }

        try {
            await guild.members.unban(targetId, `[CMD] ${cleanReason} (Moderator: ${interaction.user.tag})`);
        } catch (error) {
            console.error('Failed to unban user:', error);
            return interaction.editReply({ content: '❌ An error occurred while trying to unban this user. Please check my permissions.', flags: [MessageFlags.Ephemeral] });
        }

        await db.query(`
            UPDATE modlogs SET status = $1, endsAt = NULL 
            WHERE guildid = $2 AND userid = $3 AND status = $4 AND action = $5
        `, ['EXPIRED', guildId, targetId, 'ACTIVE', 'BAN']);

        const unbanCaseId = `CASE-${currentTimestamp}`;
        await db.query(`
            INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, appealable, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [unbanCaseId, guildId, 'UNBAN', ban.user.id, ban.user.tag, interaction.user.id, interaction.user.tag, cleanReason, currentTimestamp, 0, 'EXECUTED']);

        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2", [guildId, 'modlog']);
        const modLogChannelId = modLogResult.rows[0]?.channel_id;
        
        if (modLogChannelId) {
            const channel = guild.channels.cache.get(modLogChannelId);
            if (channel) {
                const modLogEmbed = new EmbedBuilder()
                    .setColor(UNBAN_COLOR)
                    .setAuthor({ name: `${ban.user.tag} has been UNBANNED`, iconURL: ban.user.displayAvatarURL({ dynamic: true }) })
                    .addFields(
                        { name: '👤 User', value: `${ban.user.tag} (\`${targetId}\`)`, inline: true },
                        { name: '👮 Moderator', value: `<@${interaction.user.id}>`, inline: true },
                        { name: '📝 Reason for Unban', value: cleanReason, inline: false }
                    )
                    .setFooter({ text: `Case ID: ${unbanCaseId}` })
                    .setTimestamp();
                
                const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(console.error);
                if (sentMessage) {
                    await db.query("UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2", [sentMessage.id, unbanCaseId]);
                }
            }
        }
        
        const publicEmbed = new EmbedBuilder()
            .setColor(UNBAN_COLOR)
            .setTitle('✅ Unban Successful')
            .setDescription(`The user **${ban.user.tag}** has been **unbanned** and is free to rejoin.`)
            .setThumbnail(ban.user.displayAvatarURL({ dynamic: true, size: 64 }))
            .addFields(
                { name: '👮 Moderator', value: `<@${interaction.user.id}>`, inline: true },
                { name: '🧾 Case ID', value: `\`${unbanCaseId}\``, inline: true },
                { name: '📝 Reason', value: cleanReason, inline: false }
            )
            .setFooter({ text: `User ID: ${targetId}` })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [publicEmbed] });
    },
};