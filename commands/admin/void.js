const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');

const VOID_COLOR = 0x546E7A;

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('void')
        .setDescription("Annuls (marks as void) a finished moderation case.")
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
        
        // --- LÓGICA DE ESTADO CORREGIDA ---
        if (log.status === 'ACTIVE') {
            return interaction.editReply({ content: `❌ This case is still **ACTIVE**. Please remove the punishment (unban/unmute) before you can void this case.`, flags: [MessageFlags.Ephemeral] });
        }

        if (log.status === 'VOIDED' || log.status === 'REMOVED') {
            return interaction.editReply({ content: `❌ Case ID \`${caseId}\` is already marked as **${log.status}** and cannot be voided again.`, flags: [MessageFlags.Ephemeral] });
        }
        // Si el estado es 'EXPIRED' o 'PERMANENT', el código ahora continuará.
        // --- FIN DE LA CORRECCIÓN ---

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
        
        const user = await interaction.client.users.fetch(log.userid).catch(() => null);
        const confirmationEmbed = new EmbedBuilder()
            .setColor(VOID_COLOR)
            .setTitle('✅ Case Annulled (VOIDED)')
            .setDescription(`The moderation log for **Case ID \`${caseId}\`** has been successfully annulled.`)
            .setThumbnail(user ? user.displayAvatarURL({ dynamic: true, size: 64 }) : null)
            .addFields(
                { name: '👤 User', value: `<@${log.userid}> (${log.usertag || 'Unknown Tag'})`, inline: true },
                { name: '🔨 Original Action', value: log.action, inline: true },
                { name: '👮 Moderator', value: interaction.user.tag, inline: true },
                { name: '📝 Void Reason', value: voidReason, inline: false }
            )
            .setFooter({ text: `This case will now appear as voided.` })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [confirmationEmbed] });
    },
};