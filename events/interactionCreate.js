const { Events, PermissionsBitField, MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder } = require('discord.js');
const ms = require('ms');

const MAIN_GUILD_ID = process.env.DISCORD_GUILD_ID;
const APPEAL_GUILD_ID = process.env.DISCORD_APPEAL_GUILD_ID;


async function safeDefer(interaction, isUpdate = false, isEphemeral = false) {
    try {
        if (isUpdate) {
            await interaction.deferUpdate();
        } else {
            await interaction.deferReply({ ephemeral: isEphemeral });
        }
        return true;
    } catch (error) {
        if (error.code === 10062) { // Unknown Interaction
            console.warn(`[WARN] Interaction expired before it could be deferred/updated. (Custom ID: ${interaction.customId})`);
            return false;
        }
        console.error(`[FATAL] An unhandled error occurred during deferral:`, error);
        return false;
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction) {
            console.error("[ERROR] InteractionCreate event fired with undefined payload. Ignoring.");
            return;
        }

        const db = interaction.client.db;
        const guildId = interaction.guild?.id;

        const setupCommand = interaction.client.commands.get('setup');
        const generateSetupContent = setupCommand?.generateSetupContent; 
        
        const logsPerPage = 5;

        const generateLogEmbed = (logs, targetUser, page, totalPages, authorId, isWarningLog = false) => {
            const start = page * logsPerPage;
            const currentLogs = logs.slice(start, start + logsPerPage);
            const description = currentLogs.map(log => {
                const timestamp = Math.floor(Number(log.timestamp) / 1000);
                const action = log.action.charAt(0).toUpperCase() + log.action.slice(1).toLowerCase();
                const isRemoved = log.status === 'REMOVED' || log.status === 'VOIDED';
                const text = `**${action}** - <t:${timestamp}:f> (\`${log.caseid}\`)\n**Moderator:** ${log.moderatortag}\n**Reason:** ${log.reason}`;
                return isRemoved ? `~~${text}~~` : text;
            }).join('\n\n') || "No logs found for this page.";

            const embed = new EmbedBuilder().setColor(isWarningLog ? 0xFFA500 : 0x3498DB).setTitle(`${isWarningLog ? 'Warnings' : 'Moderation Logs'} for ${targetUser.tag}`).setDescription(description).setFooter({ text: `Page ${page + 1} of ${totalPages} | Total Logs: ${logs.length}` });
            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`${isWarningLog ? 'warns' : 'modlogs'}_prev_${targetUser.id}_${authorId}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId(`${isWarningLog ? 'warns' : 'modlogs'}_next_${targetUser.id}_${authorId}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
                new ButtonBuilder().setCustomId(`modlogs_purge-prompt_${targetUser.id}_${authorId}`).setLabel('Purge All Modlogs').setStyle(ButtonStyle.Danger).setDisabled(isWarningLog)
            );
            return { embed, components: [buttons] };
        };

        if (interaction.isChatInputCommand()) {
            console.log(`[INTERACTION CREATE] Event Fired! Command: /${interaction.commandName}, User: ${interaction.user.tag}, Interaction ID: ${interaction.id}`);
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) {
                return interaction.reply({ content: 'Error: This command does not exist.', ephemeral: true }).catch(() => {});
            }
            
            const isPublic = command.isPublic ?? false;
            const deferred = await safeDefer(interaction, false, !isPublic);
            if (!deferred) return;

            // --- BLOQUE DE PERMISOS CORREGIDO ---
            try {
                // 1. Los administradores siempre tienen acceso a todo.
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    
                    // 2. Obtenemos los roles configurados en /setup para este comando.
                    const allowedRolesResult = await db.query('SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2', [interaction.guild.id, command.data.name]);
                    const allowedRoles = allowedRolesResult.rows.map(r => r.role_id);
                    
                    let isAllowed = false;

                    // 3. Comprobamos si se ha configurado algún rol personalizado.
                    if (allowedRoles.length > 0) {
                        // Si hay roles en /setup, la única forma de pasar es teniendo uno de ellos.
                        // Los permisos de Discord por defecto se ignoran.
                        isAllowed = interaction.member.roles.cache.some(role => allowedRoles.includes(role.id));
                    } else {
                        // 4. Si NO hay roles en /setup, usamos el sistema de permisos por defecto de Discord.
                        if (command.data.default_member_permissions) {
                            isAllowed = interaction.member.permissions.has(command.data.default_member_permissions);
                        } else {
                            // Si el comando no tiene permisos por defecto, se permite.
                            isAllowed = true;
                        }
                    }

                    // 5. Si después de todas las comprobaciones no está permitido, se deniega el acceso.
                    if (!isAllowed) {
                        return interaction.editReply({ content: 'You do not have the required permissions for this command.' });
                    }
                }
            } catch (dbError) {
                console.error('[ERROR] Database query for permissions failed:', dbError);
                return interaction.editReply({ content: 'A database error occurred while checking permissions.' });
            }
            // --- FIN DEL BLOQUE CORREGIDO ---
            
            try {
                await command.execute(interaction); 
                const cmdLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [interaction.guild.id, 'cmdlog']);
                const cmdLogChannelId = cmdLogResult.rows[0]?.channel_id;
                if (cmdLogChannelId) {
                    const options = interaction.options.data.map(opt => `${opt.name}:\`${opt.value}\``).join(' ');
                    const fullCommand = `</${interaction.commandName}:${interaction.commandId}> ${options}`.trim();
                    const logEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('Command Executed').setDescription(`Executed by <@${interaction.user.id}> in <#${interaction.channel.id}>`).addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})` }, { name: 'Command', value: `\`${fullCommand}\`` }).setTimestamp();
                    const channel = interaction.guild.channels.cache.get(cmdLogChannelId);
                    if (channel) { channel.send({ embeds: [logEmbed] }).catch(e => console.error(`[ERROR] Could not send command log: ${e.message}`)); }
                }
            } catch (error) {
                console.error(`[ERROR] An error occurred while executing /${interaction.commandName}:`, error);
                await interaction.editReply({ content: 'There was an error while executing this command!' }).catch(() => {});
            }
            return; 
        }

        // --- EL RESTO DEL CÓDIGO PERMANECE IGUAL ---
        if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isModalSubmit()) {
            const { customId, values } = interaction;
            const parts = customId.split('_');
            
            if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) {
                 const logsAuthorId = customId.split('_').pop();
                 if (interaction.user.id !== logsAuthorId) {
                     return interaction.reply({ content: "❌ Only the user who ran the original command can use these buttons.", flags: [MessageFlags.Ephemeral] });
                 }
            }
            
            if (customId === 'automod_add_rule') {
                if (!await safeDefer(interaction, true)) return;
                const menu = new StringSelectMenuBuilder().setCustomId('automod_action_select').setPlaceholder('1. Select punishment type...').addOptions([{ label: 'Ban (Permanent/Temporary)', value: 'BAN' },{ label: 'Mute (Timed only)', value: 'MUTE' },{ label: 'Kick (Instant)', value: 'KICK' }]);
                const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_automod').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤖 Add Automod Rule - Step 1/3').setDescription('Select the action to take when the warning threshold is reached.')], components: [new ActionRowBuilder().addComponents(menu), backButton] });
                return;
            }
            
            if (customId === 'automod_remove_rule') {
                if (!await safeDefer(interaction, false, true)) return;
                const rulesResult = await db.query('SELECT rule_order, warnings_count, action_type, action_duration FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]);
                if (rulesResult.rows.length === 0) return interaction.editReply({ content: '❌ There are no Automod rules configured to remove.' });
                const options = rulesResult.rows.map(rule => ({ label: `Rule #${rule.rule_order}: ${rule.warnings_count} warns -> ${rule.action_type}${rule.action_duration ? ` (${rule.action_duration})` : ' (Permanent)'}`, value: rule.rule_order.toString() }));
                const menu = new StringSelectMenuBuilder().setCustomId('automod_select_remove').setPlaceholder('Select the rule number to remove...').addOptions(options);
                return interaction.editReply({ content: 'Please select the rule you wish to **permanently delete**:', components: [new ActionRowBuilder().addComponents(menu)] });
            }

            if (customId === 'automod_action_select') {
                if (!await safeDefer(interaction, true)) return;
                const actionType = values[0];
                const warnOptions = Array.from({ length: 10 }, (_, i) => ({ label: `${i + 1} Warning${i > 0 ? 's' : ''}`, value: `${i + 1}:${actionType}` }));
                const menu = new StringSelectMenuBuilder().setCustomId('automod_warn_select').setPlaceholder(`2. Select warning count for ${actionType}...`).addOptions(warnOptions);
                const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_automod').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤖 Add Automod Rule - Step 2/3').setDescription(`Action selected: **${actionType}**. Now select the warning count.`)], components: [new ActionRowBuilder().addComponents(menu), backButton] });
                return;
            }
            
            if (customId === 'automod_warn_select') {
                const [warnCountStr, actionType] = values[0].split(':');
                const warnCount = parseInt(warnCountStr, 10);

                if (actionType === 'KICK') {
                    await interaction.deferUpdate();
                    try {
                        const maxOrderResult = await db.query('SELECT MAX(rule_order) FROM automod_rules WHERE guildid = $1', [guildId]);
                        const nextRuleOrder = (maxOrderResult.rows[0].max || 0) + 1;
                        await db.query(`INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type, action_duration) VALUES ($1, $2, $3, $4, NULL) ON CONFLICT (guildid, warnings_count) DO UPDATE SET rule_order = EXCLUDED.rule_order, action_type = EXCLUDED.action_type, action_duration = EXCLUDED.action_duration`, [guildId, nextRuleOrder, warnCount, actionType]);
                        const { embed: updatedEmbed, components: updatedComponents } = await generateSetupContent(interaction, guildId);
                        await interaction.editReply({ content: `✅ Automod rule for **${warnCount} warns** has been created (Action: Kick).`, embeds: [updatedEmbed], components: updatedComponents });
                    } catch (error) {
                        console.error('[ERROR] Failed to save KICK rule:', error);
                        await interaction.editReply({ content: '❌ An unexpected database error occurred saving the KICK rule.' });
                    }
                    return;
                } else {
                    const modal = new ModalBuilder().setCustomId(`automod_duration_modal:${warnCountStr}:${actionType}`).setTitle(`Set Duration for ${actionType}`);
                    const durationInput = new TextInputBuilder().setCustomId('duration_value').setLabel(`Enter Duration (e.g., 7d, 1h)`).setPlaceholder(`Max: ${actionType === 'MUTE' ? '28d' : 'Permanent (e.g., 7d, 0)'} | Use '0' for permanent BAN.`).setStyle(TextInputStyle.Short).setRequired(true);
                    modal.addComponents(new ActionRowBuilder().addComponents(durationInput));
                    await interaction.showModal(modal);
                    return;
                }
            }
            
            if (customId === 'automod_select_remove' && generateSetupContent) {
                await interaction.deferUpdate();
                const ruleOrder = parseInt(values[0], 10);
                try {
                    const result = await db.query('DELETE FROM automod_rules WHERE guildid = $1 AND rule_order = $2 RETURNING warnings_count', [guildId, ruleOrder]);
                    const deletedWarnCount = result.rows[0]?.warnings_count;
                    const remainingRulesResult = await db.query('SELECT id FROM automod_rules WHERE guildid = $1 ORDER BY warnings_count ASC', [guildId]);
                    for (const [i, rule] of remainingRulesResult.rows.entries()) {
                        await db.query('UPDATE automod_rules SET rule_order = $1 WHERE id = $2', [i + 1, rule.id]);
                    }
                    const { embed: updatedEmbed, components: updatedComponents } = await generateSetupContent(interaction, guildId);
                    await interaction.editReply({ content: `✅ Automod rule #${ruleOrder} (for **${deletedWarnCount} warns**) has been **permanently deleted** and re-indexed.`, embeds: [updatedEmbed], components: updatedComponents });
                } catch (error) {
                    console.error('[ERROR] Failed to delete automod rule:', error);
                    await interaction.editReply({ content: `❌ Error: Failed to delete rule #${ruleOrder}.`, components: [] });
                }
                return;
            }
            
            if (customId === 'start_appeal_process') {
                if (interaction.guild.id !== APPEAL_GUILD_ID) return interaction.reply({ content: '❌ This button must be used in the designated appeal server.', flags: [MessageFlags.Ephemeral] });
                const appealChannelResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2", [MAIN_GUILD_ID, 'banappeal']);
                if (appealChannelResult.rows.length === 0) return interaction.reply({ content: '❌ The Ban Appeal log channel is not configured in the Main Guild.', flags: [MessageFlags.Ephemeral] });
                const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID).catch(() => null);
                if (!mainGuild) return interaction.reply({ content: '❌ Cannot access the Main Guild.', flags: [MessageFlags.Ephemeral] });
                const banEntry = await mainGuild.bans.fetch(interaction.user.id).catch(() => null);
                if (!banEntry) return interaction.reply({ content: `❌ You are not currently banned from **${mainGuild.name}**.`, flags: [MessageFlags.Ephemeral] });
                const blacklistResult = await db.query("SELECT * FROM appeal_blacklist WHERE userid = $1 AND guildid = $2", [interaction.user.id, MAIN_GUILD_ID]);
                if (blacklistResult.rows.length > 0) return interaction.reply({ content: '❌ Your appeal for the Main Guild is currently **blacklisted**.', flags: [MessageFlags.Ephemeral] });
                
                const modal = new ModalBuilder().setCustomId('appeal:submit:prompt').setTitle('📝 Ban Appeal Application');
                const q1 = new TextInputBuilder().setCustomId('appeal_q1').setLabel('1. Why were you banned?').setStyle(TextInputStyle.Paragraph).setMinLength(20).setMaxLength(1000).setRequired(true);
                const q2 = new TextInputBuilder().setCustomId('appeal_q2').setLabel('2. Why should your appeal be accepted?').setStyle(TextInputStyle.Paragraph).setMinLength(20).setMaxLength(1000).setRequired(true);
                const q3 = new TextInputBuilder().setCustomId('appeal_q3').setLabel('3. Anything else to add?').setStyle(TextInputStyle.Paragraph).setRequired(false);
                modal.addComponents(new ActionRowBuilder().addComponents(q1), new ActionRowBuilder().addComponents(q2), new ActionRowBuilder().addComponents(q3));
                await interaction.showModal(modal);
                return;
            }

            if (interaction.isModalSubmit()) {
                if (customId.startsWith('appeal:submit:')) {
                    await interaction.deferReply({ ephemeral: true });
                    const q1 = interaction.fields.getTextInputValue('appeal_q1');
                    const q2 = interaction.fields.getTextInputValue('appeal_q2');
                    const q3 = interaction.fields.getTextInputValue('appeal_q3') || 'N/A';
                    const mainGuild = await interaction.client.guilds.fetch(MAIN_GUILD_ID).catch(() => null);
                    if (!mainGuild) return interaction.editReply({ content: '❌ Cannot access the Main Guild.' });
                    const appealChannelResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2", [MAIN_GUILD_ID, 'banappeal']);
                    const appealChannelId = appealChannelResult.rows[0]?.channel_id;
                    if (!appealChannelId) return interaction.editReply({ content: '❌ Appeal log channel not configured.' });
                    const appealChannel = mainGuild.channels.cache.get(appealChannelId);
                    if (!appealChannel) return interaction.editReply({ content: '❌ Appeal log channel inaccessible.' });
                    
                    const caseId = `MANUAL-APP-${Date.now()}`;
                    const appealEmbed = new EmbedBuilder().setColor(0x5865F2).setTitle(`📝 NEW BAN APPEAL`).setAuthor({ name: `${interaction.user.tag} (${interaction.user.id})`, iconURL: interaction.user.displayAvatarURL() }).addFields({ name: 'Why were you banned?', value: q1 }, { name: 'Why should we unban you?', value: q2 }, { name: 'Anything else?', value: q3 }).setTimestamp();
                    const actionRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`appeal:accept:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`appeal:reject:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`appeal:blacklist:${caseId}:${interaction.user.id}:${MAIN_GUILD_ID}`).setLabel('🚫 Blacklist & Reject').setStyle(ButtonStyle.Secondary)
                    );
                    await appealChannel.send({ embeds: [appealEmbed], components: [actionRow] });
                    return interaction.editReply({ content: `✅ Your appeal has been submitted for review. (Reference ID: \`${caseId}\`)` });
                }

                if (customId.startsWith('automod_duration_modal:')) {
                    await interaction.deferReply({ ephemeral: true });
                    const [, warnCountStr, actionType] = customId.split(':');
                    const warnCount = parseInt(warnCountStr, 10);
                    const durationInput = interaction.fields.getTextInputValue('duration_value').trim();
                    let errorMessage = null;
                    if (actionType === 'MUTE' && (durationInput === '0' || !ms(durationInput) || ms(durationInput) > ms('28d'))) errorMessage = '❌ Invalid MUTE duration.';
                    if (actionType === 'BAN' && durationInput !== '0' && !ms(durationInput)) errorMessage = '❌ Invalid BAN duration.';
                    if (errorMessage) return interaction.editReply({ content: errorMessage });
                    
                    try {
                        const maxOrderResult = await db.query('SELECT MAX(rule_order) FROM automod_rules WHERE guildid = $1', [guildId]);
                        const nextRuleOrder = (maxOrderResult.rows[0].max || 0) + 1;
                        await db.query(`INSERT INTO automod_rules (guildid, rule_order, warnings_count, action_type, action_duration) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (guildid, warnings_count) DO UPDATE SET rule_order = EXCLUDED.rule_order, action_type = EXCLUDED.action_type, action_duration = EXCLUDED.action_duration`, [guildId, nextRuleOrder, warnCount, actionType, durationInput === '0' ? null : durationInput]);
                        await interaction.editReply({ content: `✅ Automod rule for **${warnCount} warns** has been created/updated. Refreshing panel...` });
                        if (generateSetupContent) {
                            const { embed, components } = await generateSetupContent(interaction, guildId);
                            await interaction.message.edit({ embeds: [embed], components }).catch(() => {});
                        }
                    } catch (error) {
                        console.error('[FATAL ERROR] Failed to add/update automod rule:', error);
                        return interaction.editReply({ content: `❌ An unexpected database error occurred.` });
                    }
                    return;
                }
            }
            
            if (customId.startsWith('appeal:')) {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return interaction.reply({ content: '❌ You do not have permission to manage appeals.', flags: [MessageFlags.Ephemeral] });
                await interaction.deferUpdate();
                const [, decision, caseId, userId, banGuildId] = customId.split(':');
                const user = await interaction.client.users.fetch(userId).catch(() => null);
                const banGuild = await interaction.client.guilds.fetch(banGuildId).catch(() => null);
                if (!user || !banGuild) return interaction.editReply({ content: '❌ Error: Cannot process.' });

                const originalEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(originalEmbed).setFooter({ text: `${decision} by ${interaction.user.tag}` }).setTimestamp();

                switch (decision) {
                    case 'accept':
                        newEmbed.setColor(0x2ECC71);
                        await banGuild.members.unban(userId, `Appeal Accepted by ${interaction.user.tag}`).catch(() => {});
                        await user.send(`✅ Your ban appeal for **${banGuild.name}** has been accepted.`).catch(() => {});
                        break;
                    case 'reject':
                        newEmbed.setColor(0xE74C3C);
                        await user.send(`❌ Your ban appeal for **${banGuild.name}** has been rejected.`).catch(() => {});
                        break;
                    case 'blacklist':
                        newEmbed.setColor(0x000000);
                        await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, banGuildId]);
                        await user.send(`🚫 Your ban appeal for **${banGuild.name}** has been rejected and you are blacklisted from appealing.`).catch(() => {});
                        break;
                }
                await interaction.editReply({ embeds: [newEmbed], components: [] });
            }

            if (customId.startsWith('modlogs_') || customId.startsWith('warns_')) {
                const [prefix, action, userId, authorId] = parts;
                if (interaction.user.id !== authorId) return interaction.reply({ content: "❌ Only the user who ran the original command can use these buttons.", flags: [MessageFlags.Ephemeral] });
                
                if (action === 'next' || action === 'prev') {
                    await interaction.deferUpdate();
                    const targetUser = await interaction.client.users.fetch(userId);
                    const isWarningLog = prefix === 'warns';
                    const logsResult = await db.query(`SELECT * FROM modlogs WHERE userid = $1 AND guildid = $2 ${isWarningLog ? "AND action = 'WARN'" : ""} ORDER BY timestamp DESC`, [userId, guildId]);
                    const logs = logsResult.rows;
                    const totalPages = Math.ceil(logs.length / logsPerPage);
                    let currentPage = parseInt(interaction.message.embeds[0].footer.text.split(' ')[1], 10) - 1;
                    currentPage += (action === 'next' ? 1 : -1);
                    const { embed, components } = generateLogEmbed(logs, targetUser, currentPage, totalPages, authorId, isWarningLog);
                    await interaction.editReply({ embeds: [embed], components });
                    return;
                }

               // --- BLOQUE MODIFICADO ---
                if (action === 'purge-prompt') {
                    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '❌ You need Administrator permissions.', flags: [MessageFlags.Ephemeral] });
                   
                    await interaction.deferReply({ ephemeral: true });

                    const confirmationButtons = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`modlogs_purge-confirm_${userId}_${authorId}`).setLabel('Yes, Delete PERMANENTLY').setStyle(ButtonStyle.Danger), 
                        new ButtonBuilder().setCustomId(`modlogs_purge-cancel_${userId}_${authorId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
                    );

                    
                    return interaction.editReply({ 
                        content: `⚠️ **PERMANENT DELETE WARNING:** Are you sure you want to delete **ALL** moderation logs for <@${userId}>? This cannot be undone.`, 
                        components: [confirmationButtons] 
                    });
                }
                
                if (action === 'purge-confirm') {
                    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
                    await interaction.deferUpdate();
                    const targetUser = await interaction.client.users.fetch(userId);
                    await db.query("DELETE FROM modlogs WHERE userid = $1 AND guildid = $2", [userId, guildId]);
                    await interaction.editReply({ content: `✅ All **${targetUser.tag}** modlogs have been **PERMANENTLY DELETED**.`, components: [] });
                    const purgedEmbed = new EmbedBuilder().setTitle('Logs Purged').setDescription(`The logs for this user were purged by <@${interaction.user.id}>.`).setColor(0xAA0000);
                    await interaction.message.edit({ embeds: [purgedEmbed], components: [] }).catch(() => {});
                    return;
                }
                if (action === 'purge-cancel') return interaction.update({ content: 'Purge cancelled.', components: [] });
            }
            
            if (customId.startsWith('warns_remove-start_')) {
                await interaction.deferReply({ ephemeral: true });
                const [, , userId, authorId] = parts;
                const activeWarningsResult = await db.query("SELECT caseid, reason FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'WARN' AND status = 'ACTIVE' ORDER BY timestamp DESC", [userId, guildId]);
                if (activeWarningsResult.rows.length === 0) return interaction.editReply({ content: '❌ This user has no active warnings to remove.' });
                const options = activeWarningsResult.rows.map(w => ({ label: `Case ID: ${w.caseid}`, description: w.reason.substring(0, 50), value: w.caseid }));
                const menu = new StringSelectMenuBuilder().setCustomId(`warns_remove-select_${userId}_${authorId}`).setPlaceholder('Select a warning to annul...').addOptions(options);
                return interaction.editReply({ content: 'Please select an active warning to **annul** (mark as removed):', components: [new ActionRowBuilder().addComponents(menu)] });
            }

          if (customId.startsWith('warns_remove-select_')) {
                await interaction.deferUpdate();
                const caseIdToRemove = values[0];
                let editSuccess = false;

                try {
                    const logResult = await db.query('SELECT * FROM modlogs WHERE caseid = $1 AND guildid = $2', [caseIdToRemove, interaction.guild.id]);
                    const log = logResult.rows[0];

                    await db.query("UPDATE modlogs SET status = 'REMOVED' WHERE caseid = $1 AND guildid = $2", [caseIdToRemove, interaction.guild.id]);

                    if (log && log.logmessageid) {
                        try {
                            const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE log_type='modlog' AND guildid = $1", [interaction.guild.id]);
                            const modLogChannelId = modLogResult.rows[0]?.channel_id;
                            
                            if (modLogChannelId) {
                                const channel = await interaction.client.channels.fetch(modLogChannelId);
                                const message = await channel.messages.fetch(log.logmessageid);

                                if (message && message.embeds.length > 0) {
                                    const originalEmbed = message.embeds[0];
                                    const originalDescription = originalEmbed.description || '';
                                    
                                    // --- LÓGICA MODIFICADA ---
                                    const newEmbed = EmbedBuilder.from(originalEmbed)
                                        .setDescription(`~~${originalDescription}~~`) // <-- LÍNEA MODIFICADA PARA TACHAR
                                        .setColor(0x95A5A6)
                                        .setTitle(`⚠️ Case Annulled: ${log.action.toUpperCase()}`)
                                        .setFooter({ text: `Case ID: ${caseIdToRemove} | Status: REMOVED` });
                                    // --- FIN DE LA MODIFICACIÓN ---
                                    
                                    await message.edit({ embeds: [newEmbed] });
                                    editSuccess = true;
                                }
                            }
                        } catch (error) {
                            console.warn(`[WARN-REMOVE] Could not edit log message for Case ID ${caseIdToRemove}: ${error.message}`);
                        }
                    }

                    await interaction.editReply({ 
                        content: `✅ Warning \`${caseIdToRemove}\` has been successfully **annulled**. ${editSuccess ? 'The original log embed has been updated.' : ''}`, 
                        components: [] 
                    });

                } catch (dbError) {
                    console.error('[ERROR] Failed to annul warning:', dbError);
                    await interaction.editReply({ content: '❌ A database error occurred while trying to annul the warning.' });
                }
                return;
            }
            
            if (interaction.isChannelSelectMenu() && customId.endsWith('_channel') && generateSetupContent) {
                await interaction.deferUpdate();
                const logType = customId.replace('select_', '').replace('_channel', '');
                await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, logType, values[0]]);
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ embeds: [embed], components: components });
                return;
            }

            if (interaction.isRoleSelectMenu() && (customId === 'select_staff_roles' || customId.startsWith('perms_role_select_')) && generateSetupContent) {
                await interaction.deferUpdate();
                if (customId === 'select_staff_roles') {
                    await db.query(`INSERT INTO guild_settings (guildid, staff_roles) VALUES ($1, $2) ON CONFLICT(guildid) DO UPDATE SET staff_roles = $2`, [guildId, values.join(',')]);
                } else {
                    const commandName = customId.replace('perms_role_select_', '');
                    await db.query('DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2', [guildId, commandName]);
                    for (const roleId of values) {
                        await db.query('INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)', [guildId, commandName, roleId]);
                    }
                }
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ content: '✅ Settings updated.', embeds: [embed], components: components });
                return;
            }

            if (interaction.isStringSelectMenu() && customId === 'select_command_perms') {
                await interaction.deferUpdate();
                const commandName = values[0];
                const menu = new RoleSelectMenuBuilder().setCustomId(`perms_role_select_${commandName}`).setPlaceholder(`Select roles for /${commandName}...`).setMinValues(0).setMaxValues(25);
                const actionButtons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Volver').setStyle(ButtonStyle.Secondary));
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`Permissions for /${commandName}`).setDescription('Select roles that can use this command.')], components: [new ActionRowBuilder().addComponents(menu), actionButtons] });
                return;
            }
        }
    },
};
