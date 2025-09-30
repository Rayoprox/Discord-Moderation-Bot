const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType, MessageFlags } = require('discord.js');

const UNLOCK_COLOR = 0x2ECC71; 
const ERROR_COLOR = 0xE74C3C; 

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlocks a channel, allowing members to send messages.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to unlock. Defaults to the current channel.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for unlocking the channel.')
                .setRequired(false)),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const everyoneRole = interaction.guild.roles.everyone;

        const cleanReason = reason.trim();

        const perms = channel.permissionOverwrites.cache.get(everyoneRole.id);
        if (!perms || !perms.deny.has(PermissionsBitField.Flags.SendMessages)) {
            return interaction.editReply({ content: `❌ Channel ${channel} is **not currently locked**.`, flags: [MessageFlags.Ephemeral] });
        }

        try {
            await channel.permissionOverwrites.edit(everyoneRole, {
                SendMessages: null, 
            }, `Channel unlocked by ${interaction.user.tag} for reason: ${cleanReason}`); 

            const unlockEmbed = new EmbedBuilder()
                .setColor(UNLOCK_COLOR)
                .setTitle('🔓 Channel Unlocked')
                .setDescription(`This channel has been **UNLOCKED** and communications are restored.`)
                .addFields(
                    { name: '👮 Moderator', value: `${interaction.user.tag}`, inline: true },
                    { name: '📝 Reason', value: cleanReason, inline: false }
                )
                .setTimestamp();
            await channel.send({ embeds: [unlockEmbed] });

            await interaction.editReply({ 
                embeds: [new EmbedBuilder()
                    .setColor(UNLOCK_COLOR)
                    .setDescription(`✅ Channel ${channel} has been **UNLOCKED** successfully.`)
                ],
                flags: [MessageFlags.Ephemeral] 
            });

        } catch (error) {
            console.error("Failed to unlock channel:", error);
            await interaction.editReply({ 
                content: '❌ An error occurred. Check my permissions to manage this channel.',
                flags: [MessageFlags.Ephemeral] 
            });
        }
    },
};