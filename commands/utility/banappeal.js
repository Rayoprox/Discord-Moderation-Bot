const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType, PermissionsBitField, MessageFlags } = require('discord.js');

module.exports = {
    deploy: 'appeal',
    // No se añade 'isPublic' para que la respuesta sea privada por defecto
    data: new SlashCommandBuilder()
        .setName('banappeals')
        .setDescription('Posts the ban appeal information embed.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('The channel to post the appeal embed in.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel');

        const appealEmbed = new EmbedBuilder().setColor(0x5865F2).setTitle('🛡️ Official Ban Appeal System').setDescription('If you have been permanently banned from our main server and believe the punishment was unfair, you can **start your appeal application** here.').addFields({ name: '⚠️ Key Requirement', value: 'You need the **Case ID** that was sent to you via Direct Message (DM) at the time of your ban. Without this ID, you will not be able to proceed.',},{ name: '📜 Process', value: 'Click the button below, fill out the form, and submit it. The moderation team will review your case.', }).setFooter({ text: 'Please be honest and concise in your answers. | Reviews may take up to 48 hours.' });
        const appealButton = new ButtonBuilder().setCustomId('start_appeal_process').setLabel('Start Ban Appeal').setStyle(ButtonStyle.Danger).setEmoji('📝');
        const row = new ActionRowBuilder().addComponents(appealButton);

        try {
            await channel.send({ embeds: [appealEmbed], components: [row] });
            await interaction.editReply({ content: `✅ The appeal embed has been successfully sent to ${channel}.`, flags: [MessageFlags.Ephemeral] });
        } catch (error) {
            console.error('Failed to send appeal embed:', error);
            await interaction.editReply({ content: '❌ I do not have permission to send messages in that channel.', flags: [MessageFlags.Ephemeral] });
        }
    },
};