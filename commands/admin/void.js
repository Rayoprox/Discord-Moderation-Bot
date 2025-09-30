const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');

const VOID_COLOR = 0x546E7A;

module.exports = {
    deploy: 'main',
    isPublic: true, // Respuesta pública
    data: new SlashCommandBuilder()
        .setName('void')
        .setDescription("Annuls (marks as void) an active or recorded moderation case.")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addStringOption(option => option.setName('case_id').setDescription('The Case ID of the log to void (e.g., CASE-123456789).').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for voiding this case.').setRequired(true)),

    async execute(interaction) {
        const caseId = interaction.options.getString('case_id').trim();
        const voidReason = interaction.options.getString('reason').trim();
        const guildId = interaction.guild.id;

        const logResult = await db.query('SELECT * FROM modlogs WHERE caseid = $1 AND guildid = $2', [caseId, guildId]);
        const log = logResult.rows[0];

        if (!log) {
            return interaction.editReply({ content: `❌ Case ID \`${caseId}\` not found in the logs.`, flags: [MessageFlags.Ephemeral] });
        }
        
        if (log.status === 'VOIDED' || log.status === 'REMOVED' || log.status === 'EXPIRED') {
            return interaction.editReply({ content: `❌ Case ID \`${caseId}\` is already marked as **${log.status}** and cannot be voided.`, flags: [MessageFlags.Ephemeral] });
        }

        const newReason = `[VOIDED by ${interaction.user.tag}: ${voidReason}] - Original Reason: ${log.reason}`;
        
        await db.query("UPDATE modlogs SET status = $1, reason = $2 WHERE caseid = $3", ['VOIDED', newReason, caseId]);

        if (log.logmessageid) {
            try {
                const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE log_type=$1 AND guildid = $2", ['modlog', guildId]);
                const modLogChannelId = modLogResult.rows[0]?.channel_id;
                
                if (modLogChannelId) {
                    const channel = await interaction.client.channels.fetch(modLogChannelId);
                    const message = await channel.messages.fetch(log.logmessageid);

                    if (message && message.embeds.length > 0) {
                        const originalEmbed = message.embeds[0];
                        const newEmbed = EmbedBuilder.from(originalEmbed);
                        
                        newEmbed.setColor(VOID_COLOR).setTitle(`❌ Case Voided: ${log.action.toUpperCase()}`).setFooter({ text: `Case ID: ${caseId} | Status: VOIDED` });

                        const reasonFieldIndex = originalEmbed.fields.findIndex(field => field.name.includes('Reason'));
                        if (reasonFieldIndex !== -1) {
                            newEmbed.spliceFields(reasonFieldIndex, 1, { name: '📝 Void Reason', value: newReason });
                        } else {
                            newEmbed.addFields({ name: '📝 Void Reason', value: newReason });
                        }
                        
                        await message.edit({ embeds: [newEmbed] });
                    }
                }
            } catch (error) {
                console.error(`[VOID-ERROR] Could not edit log message for Case ID ${caseId}:`, error.message);
            }
        }
        
        const confirmationEmbed = new EmbedBuilder().setColor(VOID_COLOR).setTitle('✅ Case Annulled (VOIDED)').setDescription(`The moderation log for **Case ID \`${caseId}\`** has been successfully annulled.`).setThumbnail(log.usertag ? interaction.client.users.cache.get(log.userid)?.displayAvatarURL({ dynamic: true, size: 64 }) : null).addFields({ name: '👤 User', value: `<@${log.userid}> (\`${log.usertag}\`)`, inline: true },{ name: '🔨 Original Action', value: log.action, inline: true },{ name: '👮 Moderator', value: interaction.user.tag, inline: true },{ name: '📝 Void Reason', value: voidReason, inline: false }).setFooter({ text: `This case will appear as struck-through in /modlogs and /warnings.` }).setTimestamp();
        
        await interaction.editReply({ embeds: [confirmationEmbed] });
    },
};  