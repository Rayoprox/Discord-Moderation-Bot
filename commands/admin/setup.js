const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField, ChannelType, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');

const TIMEOUT = 120_000;

// --- CENTRAL AUXILIARY FUNCTION (EXPORTED) ---
const generateSetupContent = async (interaction, guildId) => {
    // POSTGRESQL: Fetching all required data
    const [
        logChannelsResult,
        guildSettingsResult,
        permissionsResult,
        rulesResult
    ] = await Promise.all([
        db.query('SELECT * FROM log_channels WHERE guildid = $1', [guildId]),
        db.query('SELECT * FROM guild_settings WHERE guildid = $1', [guildId]),
        db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1 ORDER BY command_name', [guildId]),
        db.query('SELECT rule_order, warnings_count, action_type, action_duration FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId])
    ]);
    
    const logChannels = logChannelsResult.rows;
    const guildSettings = guildSettingsResult.rows[0] || {};
    const permissions = permissionsResult.rows;
    const rules = rulesResult.rows;
    
    // Automod Data Mapping
    const ruleSummary = rules.map(rule => {
        const duration = rule.action_duration ? ` (${rule.action_duration})` : '*Permanent*';
        return `**#${rule.rule_order}**: ${rule.warnings_count} warns -> **${rule.action_type}**${duration}`;
    }).join('\n') || '*No Automod rules set.*';
    
    // Data Mapping
    const modLog = logChannels.find(c => c.log_type === 'modlog')?.channel_id;
    const cmdLog = logChannels.find(c => c.log_type === 'cmdlog')?.channel_id;
    const banAppeal = logChannels.find(c => c.log_type === 'banappeal')?.channel_id;
    const staffRoles = guildSettings.staff_roles ? guildSettings.staff_roles.split(',').map(r => `<@&${r}>`).join(', ') : 'Not Set';
    
    const permsByCommand = permissions.reduce((acc, perm) => {
        if (!acc[perm.command_name]) acc[perm.command_name] = [];
        acc[perm.command_name].push(`<@&${perm.role_id}>`);
        return acc;
    }, {});
    const permsConfig = Object.entries(permsByCommand).map(([cmd, roles]) => `\`/${cmd}\`: ${roles.join(', ')}`).join('\n') || 'No custom permissions set.';
    
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`⚙️ ${interaction.guild.name}'s Setup Panel`)
        .setDescription(`Configure the bot using the buttons below. This panel will expire in ${TIMEOUT / 60000} minutes.`)
        .addFields(
            { name: 'Log Channels', value: `**Mod Log:** ${modLog ? `<#${modLog}>` : 'Not Set'}\n**Command Log:** ${cmdLog ? `<#${cmdLog}>` : 'Not Set'}\n**Ban Appeals:** ${banAppeal ? `<#${banAppeal}>` : 'Not Set'}` },
            { name: 'Roles', value: `**Staff Roles:** ${staffRoles}` }, 
            { name: 'Command Permissions', value: permsConfig },
            { name: '🤖 Automod Rules', value: ruleSummary }
        );

    const mainRow1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup_channels').setLabel('Log Channels').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('Staff Roles').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('setup_permissions').setLabel('Command Permissions').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('setup_automod').setLabel('Automod Rules').setStyle(ButtonStyle.Success)
    );

    const mainRow2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('delete_all_data').setLabel('Delete All Data').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel_setup').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    
    return { embed, components: [mainRow1, mainRow2] };
};
// ------------------------------------


module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Shows the main setup panel for the bot.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    // Export generateSetupContent for use in interactionCreate.js
    generateSetupContent,

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // Generate content for the initial reply (AWAIT needed)
        const { embed: mainEmbed, components: mainComponents } = await generateSetupContent(interaction, guildId);

        // CRITICAL FIX: The initial reply MUST be editReply() because interactionCreate.js deferred it.
        const response = await interaction.editReply({ 
            embeds: [mainEmbed], 
            components: mainComponents, 
            flags: [MessageFlags.Ephemeral] 
        });

        // Create the collector HERE.
        const collector = response.createMessageComponentCollector({ time: TIMEOUT });

        // The 'end' handler remains here.
        collector.on('end', () => interaction.editReply({ content: 'Setup panel has expired.', embeds: [], components: [] }).catch(() => {}));


        collector.on('collect', async i => {
            
            // Authorization Check
            if (i.user.id !== interaction.user.id) {
                // Debe ser reply porque esta interacción no ha sido diferida por el botón.
                return i.reply({ content: "❌ Only the user who ran the command can use this menu.", ephemeral: true });
            }

            // Define if the interaction is a modal/select menu to avoid an unnecessary deferUpdate.
            const isSelectMenu = i.isStringSelectMenu() || i.isRoleSelectMenu() || i.isChannelSelectMenu();
            const isButton = i.isButton();
            const opensModal = i.customId === 'automod_add_rule';
            
            // --- CRITICAL FIX: ONLY deferUpdate FOR BUTTONS THAT DO NOT OPEN MODALS ---
            if (isButton && !opensModal) { 
                // Catch error 10062 to ignore expired interactions.
                const deferSuccess = await i.deferUpdate().then(() => true).catch(e => {
                    // If the error is 10062 or 40060 (already acknowledged), ignore it.
                    if (e.code === 10062 || e.code === 40060) {
                        console.warn('[SETUP] User clicked expired button or interaction already handled (code 10062/40060), ignoring.');
                        return false; 
                    }
                    throw e; // Propagate other errors
                });
                
                // If the defer failed (expired or double-handled), exit the collect handler
                if (!deferSuccess) return;
            }
            
            // If it's a menu or opens a modal, we do not defer here.
            // Setup logic only defines the response, processing (and deferUpdate)
            // is done in interactionCreate.js.

            switch (i.customId) {
                case 'cancel_setup':
                    await i.editReply({ content: 'Setup cancelled.', embeds: [], components: [] }); 
                    return collector.stop();
                    
                case 'delete_all_data':
                    // POSTGRESQL: DELETEs (async operations)
                    await db.query('DELETE FROM log_channels WHERE guildid = $1', [guildId]);
                    await db.query('DELETE FROM guild_settings WHERE guildid = $1', [guildId]);
                    await db.query('DELETE FROM command_permissions WHERE guildid = $1', [guildId]);
                    await db.query('DELETE FROM automod_rules WHERE guildid = $1', [guildId]);
                    
                    await i.editReply({ content: '✅ All configuration data for this server has been deleted.', embeds: [], components: [] });
                    return collector.stop();
                    
                case 'setup_channels': {
                    const buttons = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('set_modlog').setLabel('Moderation Log').setStyle(ButtonStyle.Secondary), 
                        new ButtonBuilder().setCustomId('set_cmdlog').setLabel('Command Log').setStyle(ButtonStyle.Secondary), 
                        new ButtonBuilder().setCustomId('set_banappeal').setLabel('Ban Appeals').setStyle(ButtonStyle.Secondary)
                    );
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                    // Here i.editReply works because the button already deferred the update above.
                    await i.editReply({ embeds: [new EmbedBuilder().setTitle('📺 Log Channel Setup').setDescription('Select a channel type to configure.')], components: [buttons, backButton] });
                    break;
                }
                
                case 'setup_staff_roles': {
                    // The deferUpdate was handled at the start of the collect function.
                    const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
                    const currentStaffRoles = guildSettingsResult.rows[0]?.staff_roles?.split(',').filter(r => r) || [];
                    
                    // Note: We use max 25 to avoid errors; multi-select logic is in interactionCreate.js
                    let menu = new RoleSelectMenuBuilder()
                        .setCustomId('select_staff_roles')
                        .setPlaceholder('Select staff roles...')
                        .setMinValues(0)
                        .setMaxValues(25);
                        
                    const backButton = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
                    );

                    await i.editReply({ 
                        embeds: [new EmbedBuilder().setTitle('👑 Staff Roles Setup').setDescription(`Select roles that are immune to moderation. Current: **${currentStaffRoles.length}** roles selected.`)], 
                        components: [new ActionRowBuilder().addComponents(menu), backButton] 
                    });
                    break;
                }
                
                case 'setup_permissions': {
                    // Filter basic commands that do not require custom permissions
                    const commandOptions = Array.from(interaction.client.commands.keys()).filter(cmd => cmd !== 'setup' && cmd !== 'help' && cmd !== 'ping').map(cmd => ({ label: `/${cmd}`, value: cmd }));
                    const menu = new StringSelectMenuBuilder().setCustomId('select_command_perms').setPlaceholder('Select a command to configure...').addOptions(commandOptions);
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                    await i.editReply({ embeds: [new EmbedBuilder().setTitle('🛡️ Command Permissions').setDescription('Select a command to set role permissions.')], components: [new ActionRowBuilder().addComponents(menu), backButton] });
                    break;
                }
                
                case 'setup_automod': {
                    const { embed: currentEmbed } = await generateSetupContent(interaction, guildId);
                    const ruleSummary = currentEmbed.data.fields.find(f => f.name.includes('🤖 Automod Rules'))?.value || '*No Automod rules set.*';
                    
                    const rulesEmbed = new EmbedBuilder()
                        .setTitle('🤖 Automod Rules Setup')
                        .setDescription(`Configure the automatic punishment thresholds based on active warnings.`)
                        .addFields(
                            { name: 'Current Rules', value: ruleSummary }
                        )
                        .setColor(0x2ECC71);

                    const ruleActions = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('automod_add_rule').setLabel('➕ Add New Rule').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('automod_remove_rule').setLabel('➖ Remove Existing Rule').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
                    );

                    await i.editReply({ embeds: [rulesEmbed], components: [ruleActions] });
                    break;
                }
                
                case 'setup_back_to_main': {
                    const { embed: updatedEmbed, components: updatedComponents } = await generateSetupContent(interaction, guildId);
                    await i.editReply({ embeds: [updatedEmbed], components: updatedComponents });
                    break;
                }
                
                case 'set_modlog':
                case 'set_cmdlog':
                case 'set_banappeal': {
                    const logType = i.customId.replace('set_', '');
                    const menu = new ChannelSelectMenuBuilder().setCustomId(`select_${logType}_channel`).setPlaceholder('Select a channel...').addChannelTypes(ChannelType.GuildText);
                    const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('⬅️ Back to Log Options').setStyle(ButtonStyle.Secondary));
                    await i.editReply({ embeds: [new EmbedBuilder().setTitle(`📺 Select ${logType} channel`)], components: [new ActionRowBuilder().addComponents(menu), backButton] });
                    break;
                }
            }
        });
    },
};