const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

const SUCCESS_COLOR = 0x57F287;

module.exports = {
    deploy: 'main',
    isPublic: true, // Respuesta pública
    data: new SlashCommandBuilder()
        .setName('roleadd')
        .setDescription('Adds a role to a user.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
        .addUserOption(option => option.setName('user').setDescription('The user to add the role to.').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('The role to add.').setRequired(true)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const role = interaction.options.getRole('role');
        const moderatorMember = interaction.member;

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
            return interaction.editReply({ content: '❌ User is not in the server.', flags: [MessageFlags.Ephemeral] });
        }

        if (moderatorMember.roles.highest.position <= targetMember.roles.highest.position) {
            return interaction.editReply({ content: '❌ You cannot manage roles for a user with a role equal to or higher than yours.', flags: [MessageFlags.Ephemeral] });
        }
        if (moderatorMember.roles.highest.position <= role.position) {
            return interaction.editReply({ content: `❌ You cannot manage the role "${role.name}" as it is equal to or higher than your own highest role.`, flags: [MessageFlags.Ephemeral] });
        }
        if (interaction.guild.members.me.roles.highest.position <= role.position) {
            return interaction.editReply({ content: `❌ I cannot manage the role "${role.name}" as it is higher than my own role.`, flags: [MessageFlags.Ephemeral] });
        }
        if (targetMember.roles.cache.has(role.id)) {
            return interaction.editReply({ content: `❌ User **${targetUser.tag}** already has the "${role.name}" role.`, flags: [MessageFlags.Ephemeral] });
        }

        try {
            await targetMember.roles.add(role, `Role added by ${interaction.user.tag}`);
        } catch (error) {
            console.error("Failed to add role:", error);
            return interaction.editReply({ content: '❌ An unexpected error occurred while trying to add the role.', flags: [MessageFlags.Ephemeral] });
        }

        const publicEmbed = new EmbedBuilder()
            .setColor(SUCCESS_COLOR)
            .setTitle('✅ Role Assignment Successful')
            .setDescription(`The **${role.name}** role was successfully added.`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
            .addFields(
                { name: '👥 User', value: `<@${targetUser.id}> (\`${targetUser.tag}\`)`, inline: true },
                { name: '🏷️ Role', value: `${role.name}`, inline: true },
                { name: '👮 Moderator', value: interaction.user.tag, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [publicEmbed] });
    },
};