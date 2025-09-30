const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');

function createPermissionsMenu(interaction, commandNames = []) {
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('🛡️ Command Permissions Setup')
        .setDescription('Select a command from the menu below to configure roles.');

    const commandOptions = commandNames
        .filter(cmd => cmd !== 'setup')
        .map(cmd => ({ label: `/${cmd}`, value: cmd }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('perms_select_command')
        .setPlaceholder('Select a command...')
        .addOptions(commandOptions);

    const actionRow = new ActionRowBuilder().addComponents(selectMenu);

    return { embeds: [embed], components: [actionRow], fetchReply: true };
}

module.exports = { createPermissionsMenu };
