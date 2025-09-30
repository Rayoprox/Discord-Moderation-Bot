const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    deploy: 'all',
    isPublic: true, // Respuesta pública
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription("Checks the bot's response time."),

    async execute(interaction) {
        // ELIMINADO: deferReply se maneja en interactionCreate.js
        
        const apiLatency = interaction.client.ws.ping;
        const appLatency = Date.now() - interaction.createdTimestamp;

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('📡 Connection Status & Latency')
            .setDescription(`Measurement of bot responsiveness across network components.`)
            .addFields(
                { name: 'App Latency (Edit Time)', value: `⏱️ **${appLatency}ms**`, inline: true },
                { name: 'API Latency (Heartbeat)', value: `💓 **${apiLatency}ms**`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
            )
            .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};