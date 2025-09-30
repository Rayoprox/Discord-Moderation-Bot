// commands/admin/reason.js (Corregido para editar el embed de forma fiable)
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('reason')
        .setDescription("Updates the reason for a moderation case.")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addStringOption(option => option.setName('case_id').setDescription('The Case ID of the log to update.').setRequired(true))
        .addStringOption(option => option.setName('new_reason').setDescription('The new reason for this case.').setRequired(true)),

    async execute(interaction) {
        const caseId = interaction.options.getString('case_id').trim();
        const newReason = interaction.options.getString('new_reason').trim();
        const guildId = interaction.guild.id;

        const logResult = await db.query('SELECT * FROM modlogs WHERE caseid = $1 AND guildid = $2', [caseId, guildId]);
        const log = logResult.rows[0];

        if (!log) {
            return interaction.editReply({ content: `❌ Case ID \`${caseId}\` not found.`, flags: [MessageFlags.Ephemeral] });
        }

        await db.query("UPDATE modlogs SET reason = $1 WHERE caseid = $2", [newReason, caseId]);

        let editSuccess = false;
        if (log.logmessageid) {
            try {
                const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE log_type='modlog' AND guildid = $1", [guildId]);
                const modLogChannelId = modLogResult.rows[0]?.channel_id;
                
                if (modLogChannelId) {
                    const channel = await interaction.client.channels.fetch(modLogChannelId);
                    const message = await channel.messages.fetch(log.logmessageid);

                    if (message && message.embeds.length > 0) {
                        const originalEmbed = message.embeds[0];
                        
                        // Reconstruimos el embed para asegurar la compatibilidad
                        const newEmbed = new EmbedBuilder(originalEmbed.toJSON());
                        
                        // Buscamos el índice del campo de la razón
                        const reasonFieldIndex = newEmbed.data.fields.findIndex(field => field.name && field.name.toLowerCase().includes('reason'));

                        if (reasonFieldIndex !== -1) {
                            newEmbed.spliceFields(reasonFieldIndex, 1, { name: '📝 Reason', value: newReason, inline: false });
                        } else {
                            newEmbed.addFields({ name: '📝 Reason', value: newReason, inline: false });
                        }

                        await message.edit({ embeds: [newEmbed] });
                        editSuccess = true;
                    }
                }
            } catch (error) {
                console.warn(`[WARN] Could not edit log message for Case ID ${caseId}: ${error.message}`);
            }
        }
        
        const confirmationEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('✅ Reason Updated')
            .setDescription(`The reason for **Case ID \`${caseId}\`** has been updated.`)
            .addFields({ name: 'New Reason', value: `\`\`\`\n${newReason}\n\`\`\`` })
            .setFooter({ text: editSuccess ? 'The original log embed has also been updated.' : 'Could not update the original log embed.' });
        
        await interaction.editReply({ embeds: [confirmationEmbed] });
    },
};