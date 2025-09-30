const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType, MessageFlags } = require('discord.js');

const LOCK_COLOR = 0xAA0000; 
const SUCCESS_COLOR = 0x2ECC71; 

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Locks a channel, preventing members from sending messages.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to lock. Defaults to the current channel.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for locking the channel.')
                .setRequired(false)),

    async execute(interaction) {
        // NOTA: interaction.deferReply() ya fue llamado en interactionCreate.js
        
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const everyoneRole = interaction.guild.roles.everyone;
        
        // Saneamiento para el Audit Log
        const cleanReason = reason.trim();

        // Check if the channel is already locked
        const perms = channel.permissionOverwrites.cache.get(everyoneRole.id);
        if (perms && perms.deny.has(PermissionsBitField.Flags.SendMessages)) {
            // Usar editReply para la verificación
            return interaction.editReply({ content: `❌ Channel ${channel} is **already locked**!`, flags: [MessageFlags.Ephemeral] });
        }

        try {
            // Update permissions
            await channel.permissionOverwrites.edit(everyoneRole, {
                SendMessages: false,
            }, `Channel locked by ${interaction.user.tag} for reason: ${cleanReason}`); 

            // Send an embed to the locked channel (public)
            const lockEmbed = new EmbedBuilder()
                .setColor(LOCK_COLOR)
                .setTitle('🔒 Channel Locked Down: Moderation Operation')
                .setDescription(`This channel has been **LOCKED**.\nCommunity members will not be able to send messages until it is unlocked.`)
                .addFields(
                    { name: '👮 Moderator', value: `${interaction.user.tag}`, inline: true },
                    { name: '📝 Reason', value: cleanReason, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: `Please await an unlock announcement.` });
            await channel.send({ embeds: [lockEmbed] });

            // Send confirmation to the moderator (ephemeral) - Usar editReply
            await interaction.editReply({ 
                embeds: [new EmbedBuilder()
                    .setColor(SUCCESS_COLOR)
                    .setDescription(`✅ Successfully **LOCKED** channel ${channel}.`)
                ],
                flags: [MessageFlags.Ephemeral] 
            });

        } catch (error) {
            console.error("Failed to lock channel:", error);
            // Usar editReply para el error final
            await interaction.editReply({ 
                content: '❌ An unexpected error occurred. I may not have the required permissions to manage this channel.', 
                flags: [MessageFlags.Ephemeral] 
            });
        }
    },
};