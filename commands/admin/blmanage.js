const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');

const BLACKLIST_COLOR = 0x8B0000; 

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('blmanage')
        .setDescription('Manages the appeal blacklist for the server.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Adds a user to the appeal blacklist.')
                .addUserOption(option => option.setName('user').setDescription('The user to blacklist.').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Removes a user from the appeal blacklist.')
                .addUserOption(option => option.setName('user').setDescription('The user to remove from the blacklist.').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('Views the current appeal blacklist.')
        ),

    async execute(interaction) {
        // NOTA: interaction.deferReply() ya fue llamado en interactionCreate.js

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        
        if (subcommand === 'add' || subcommand === 'remove') {
            const targetUser = interaction.options.getUser('user');
            const userId = targetUser.id;
            const userTag = targetUser.tag.trim();
            
            if (subcommand === 'add') {
                try {
                    await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, guildId]);
                    
                    return interaction.editReply({ // Cambio aquí
                        embeds: [new EmbedBuilder()
                            .setColor(BLACKLIST_COLOR)
                            .setTitle('⚫ User Blacklisted')
                            .setDescription(`**${userTag}** has been added to the appeal blacklist.`)
                            .setFooter({ text: `User ID: ${userId}` })
                            .setTimestamp()],
                        flags: [MessageFlags.Ephemeral]
                    });
                } catch (error) {
                    console.error('[ERROR] Failed to add user to blacklist:', error);
                    return interaction.editReply({ content: '❌ An error occurred while adding the user to the blacklist.', flags: [MessageFlags.Ephemeral] }); // Cambio aquí
                }

            } else if (subcommand === 'remove') {
                const result = await db.query("DELETE FROM appeal_blacklist WHERE userid = $1 AND guildid = $2 RETURNING userid", [userId, guildId]);
                
                if (result.rowCount === 0) {
                    return interaction.editReply({ content: `❌ **${userTag}** is not currently in the appeal blacklist.`, flags: [MessageFlags.Ephemeral] }); // Cambio aquí
                }

                return interaction.editReply({ // Cambio aquí
                    embeds: [new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('🟢 User Un-blacklisted')
                        .setDescription(`**${userTag}** has been removed from the appeal blacklist.`)
                        .setFooter({ text: `User ID: ${userId}` })
                        .setTimestamp()],
                    flags: [MessageFlags.Ephemeral]
                });
            }
        } else if (subcommand === 'view') {
            const blacklistResult = await db.query('SELECT userid FROM appeal_blacklist WHERE guildid = $1', [guildId]);
            const blacklist = blacklistResult.rows;

            if (blacklist.length === 0) {
                return interaction.editReply({ content: 'The appeal blacklist is currently empty.', flags: [MessageFlags.Ephemeral] }); // Cambio aquí
            }

            // NOTA: Esta lógica es lenta (fetch por cada usuario) y podría necesitar optimización, 
            // pero el cambio a editReply la estabiliza.
            const userList = await Promise.all(blacklist.map(async entry => {
                const user = await interaction.client.users.fetch(entry.userid).catch(() => null);
                return `\`${entry.userid}\` - ${user ? user.tag : '*Unknown User Tag*'}`;
            }));

            const embed = new EmbedBuilder()
                .setColor(BLACKLIST_COLOR)
                .setTitle(`⚫ Appeal Blacklist (${blacklist.length} Users)`)
                .setDescription(userList.join('\n'))
                .setTimestamp();

            return interaction.editReply({ embeds: [embed], flags: [MessageFlags.Ephemeral] }); // Cambio aquí
        }
    },
};