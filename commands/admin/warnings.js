const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('Displays and manages the warnings for a user.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose logs you want to see.')
                .setRequired(true)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const authorId = interaction.user.id;
        const userId = targetUser.id;
        const guildId = interaction.guild.id;
        
        const logsResult = await db.query(
            `SELECT caseid, moderatortag, reason, timestamp, status 
             FROM modlogs 
             WHERE userid = $1 AND guildid = $2 AND action = 'WARN' 
             ORDER BY timestamp DESC`,
            [userId, guildId]
        );
        const logs = logsResult.rows;

        if (logs.length === 0) {
            // CORREGIDO: Usamos editReply y flags
            return interaction.editReply({ content: `No warnings found for **${targetUser.tag}**.`, flags: [MessageFlags.Ephemeral] });
        }

        const logsPerPage = 5;
        const totalPages = Math.ceil(logs.length / logsPerPage);
        
        const generateEmbed = (page) => {
            const start = page * logsPerPage;
            const currentLogs = logs.slice(start, start + logsPerPage);
            
            const activeCount = logs.filter(log => log.status === 'ACTIVE').length;

            const description = currentLogs.map(log => {
                const timestamp = Math.floor(Number(log.timestamp) / 1000); 
                const isRemoved = log.status === 'REMOVED' || log.status === 'VOIDED'; 
                const text = `**Warn** - <t:${timestamp}:f> (\`${log.caseid}\`)\n**Moderator:** ${log.moderatortag}\n**Reason:** ${log.reason}`;
                return isRemoved ? `~~${text}~~` : text;
            }).join('\n\n');

            return new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle(`Warnings for ${targetUser.tag}`)
                .setDescription(description)
                .addFields({ name: 'Active Warnings', value: `${activeCount}`, inline: true })
                .setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Warnings: ${logs.length}` });
        };

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`warns_prev_${targetUser.id}_${authorId}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId(`warns_next_${targetUser.id}_${authorId}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1),
            new ButtonBuilder().setCustomId(`warns_remove-start_${targetUser.id}_${authorId}`).setLabel('Remove a Warning').setStyle(ButtonStyle.Secondary).setDisabled(logs.filter(log => log.status === 'ACTIVE').length === 0)
        );

        // CORREGIDO: Usamos editReply
        await interaction.editReply({ embeds: [generateEmbed(0)], components: [buttons] });
    },
};