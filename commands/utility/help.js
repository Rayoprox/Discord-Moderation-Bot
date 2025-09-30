const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');

module.exports = {
    deploy: 'all',
    // No se añade 'isPublic' para que la respuesta sea privada por defecto
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Displays a list of commands you can use.'),

    async execute(interaction) {
        // ELIMINADO: deferReply se maneja en interactionCreate.js

        const { commands } = interaction.client;
        const member = interaction.member;
        const guildId = interaction.guild.id;

        const commandCategories = { admin: [], utility: [], appeal: [] };
        
        const allPermissionsResult = await db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1', [guildId]);
        const permMap = allPermissionsResult.rows.reduce((acc, row) => {
            if (!acc[row.command_name]) acc[row.command_name] = [];
            acc[row.command_name].push(row);
            return acc;
        }, {});
        
        for (const command of commands.values()) {
            let hasPermission = member.permissions.has(PermissionsBitField.Flags.Administrator);
            if (!hasPermission) {
                const allowedRoles = permMap[command.data.name] || [];
                if (allowedRoles.length > 0) {
                    hasPermission = member.roles.cache.some(role => allowedRoles.some(rule => rule.role_id === role.id));
                } else if (command.data.default_member_permissions) {
                    hasPermission = member.permissions.has(command.data.default_member_permissions);
                } else {
                    hasPermission = true;
                }
            }

            if (hasPermission) {
                const optionsString = command.data.options.map(opt => opt.required ? `<${opt.name}>` : `[${opt.name}]`).join(' ');
                const formattedCommand = `\`/${command.data.name} ${optionsString}\`\n*${command.data.description}*`;

                switch(command.deploy) {
                    case 'main':
                        if (['ban', 'kick', 'mute', 'unmute', 'modlogs', 'warnings', 'purge', 'reason', 'void', 'warn', 'unban', 'blmanage', 'setup'].includes(command.data.name)) {
                            commandCategories.admin.push(formattedCommand);
                        } else {
                            commandCategories.utility.push(formattedCommand);
                        }
                        break;
                    case 'appeal':
                        commandCategories.appeal.push(formattedCommand);
                        break;
                    case 'all':
                         if (command.data.name !== 'help') {
                            commandCategories.utility.push(formattedCommand);
                         }
                        break;
                }
            }
        }

        const helpEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('Help Menu - Command List')
            .setDescription(`Here is a list of commands available to you on **${interaction.guild.name}**.`);

        if (commandCategories.admin.length > 0) helpEmbed.addFields({ name: '👑 Moderation Commands', value: commandCategories.admin.join('\n\n') });
        if (commandCategories.utility.length > 0) helpEmbed.addFields({ name: '🛠️ Utility Commands', value: commandCategories.utility.join('\n\n') });
        if (commandCategories.appeal.length > 0) helpEmbed.addFields({ name: '📨 Appeal Server Commands', value: commandCategories.appeal.join('\n\n') });
        if (helpEmbed.data.fields.length === 0) helpEmbed.setDescription("It seems there are no commands available for you to use.");

        await interaction.editReply({ embeds: [helpEmbed] });
    },
};