const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('modlogs')
        .setDescription('Displays the moderation history for a user.')
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
            `SELECT caseid, action, usertag, moderatortag, reason, timestamp, status FROM modlogs WHERE userid = $1 AND guildid = $2 ORDER BY timestamp DESC`,
            [userId, guildId]
        );
        const logs = logsResult.rows;

        if (logs.length === 0) {
            return interaction.editReply({ content: `No moderation logs found for **${targetUser.tag}**.`, flags: [MessageFlags.Ephemeral] });
        }

        const logsPerPage = 5;
        const totalPages = Math.ceil(logs.length / logsPerPage);
        
        const generateEmbed = (page) => {
            const start = page * logsPerPage;
            const currentLogs = logs.slice(start, start + logsPerPage);
            
            const description = currentLogs.map(log => {
                const timestamp = Math.floor(Number(log.timestamp) / 1000); 
                const action = log.action.charAt(0).toUpperCase() + log.action.slice(1).toLowerCase();
                const isRemoved = log.status === 'REMOVED' || log.status === 'VOIDED';
                const text = `**${action}** - <t:${timestamp}:f> (\`${log.caseid}\`)\n**Moderator:** ${log.moderatortag}\n**Reason:** ${log.reason}`;
                
                return isRemoved ? `~~${text}~~` : text;
            }).join('\n\n');

            return new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle(`Moderation Logs for ${targetUser.tag}`)
                .setDescription(description)
                .setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Logs: ${logs.length}` });
        };

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`modlogs_prev_${targetUser.id}_${authorId}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId(`modlogs_next_${targetUser.id}_${authorId}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1),
            new ButtonBuilder().setCustomId(`modlogs_purge-prompt_${targetUser.id}_${authorId}`).setLabel('Purge All Modlogs').setStyle(ButtonStyle.Danger) 
        );

        await interaction.editReply({ embeds: [generateEmbed(0)], components: [buttons] });
    },
};