require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, Routes, REST, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const OpenAI = require('openai');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: ['CHANNEL']
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const allowedDMUsers = new Set();
const mutedDMUsers = new Set();
const ownerId = process.env.OWNER_ID;

let stats = {
  totalReplies: 0,
  totalDMs: 0,
  unauthorizedAttempts: 0,
  serverQuestions: 0,
  lastQuestions: {}
};

function classifyQuestion(text) {
  text = text.toLowerCase();
  if (text.includes('اشرح') || text.includes('ما الفرق') || text.includes('كيف') || text.includes('explain') || text.includes('difference')) return '🧠';
  if (text.length < 20) return '❓';
  return '💬';
}
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const isDM = message.channel.type === 1;
  const senderId = message.author.id;
  const hasImage = message.attachments.size > 0;
  const hasText = message.content?.trim().length > 0;

  if (isDM) stats.totalDMs++;

  // تجاهل الصور في السيرفر
  if (!isDM && hasImage) return;

  // تجاهل غير المصرح لهم
  if (isDM && senderId !== ownerId && !allowedDMUsers.has(senderId)) {
    stats.unauthorizedAttempts++;
    const alertChannel = client.channels.cache.get(process.env.UNAUTHORIZED_DM_CHANNEL_ID);
    if (alertChannel) {
      alertChannel.send(`🚫 Unauthorized DM:\n👤 ${message.author.tag} (${senderId})\n💬 "${message.content}"`);
    }
    return message.reply('❌ هذا البوت لا يستقبل رسائل خاصة إلا من مستخدمين محددين.');
  }

  // الرد على الصور في الخاص
  if (isDM && hasImage) {
    const image = message.attachments.first();
    const imageUrl = image.url;
    const prompt = hasText ? message.content : 'حلل محتوى هذه الصورة';

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "user", content: `${prompt}\n[صورة مرفقة: ${imageUrl}]` }
        ],
      });

      const reply = response.choices[0].message.content;
      stats.totalReplies++;
      stats.lastQuestions[senderId] = prompt;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('like').setLabel('👍').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('dislike').setLabel('👎').setStyle(ButtonStyle.Danger)
      );

      await message.reply({ content: reply, components: [row] });

      // إرسال الصورة إلى P-log (ما عدا المطور)
      if (senderId !== ownerId) {
        const pLogChannel = client.channels.cache.get(process.env.P_LOG_CHANNEL_ID);
        if (pLogChannel) {
          pLogChannel.send({
            content: `📷 صورة من ${message.author.tag}${hasText ? `\n💬 ${message.content}` : ''}`,
            files: [image]
          });
        }
      }

      // تسجيل النص في dm-logs (ما عدا المطور)
      if (senderId !== ownerId && hasText) {
        const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
        if (logChannel) {
          logChannel.send(`${classifyQuestion(message.content)} DM from ${message.author.tag}: ${message.content}`);
        }
      }

    } catch (err) {
      console.error('OpenAI error (image):', err);
      message.reply('❌ حدث خطأ أثناء تحليل الصورة.');
    }

    return;
  }

  // الرد على النصوص في الخاص
  if (isDM && hasText) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: message.content }],
      });

      const reply = response.choices[0].message.content;
      stats.totalReplies++;
      stats.lastQuestions[senderId] = message.content;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('like').setLabel('👍').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('dislike').setLabel('👎').setStyle(ButtonStyle.Danger)
      );

      await message.reply({ content: reply, components: [row] });

      // تسجيل النص في dm-logs (ما عدا المطور)
      if (senderId !== ownerId) {
        const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
        if (logChannel) {
          logChannel.send(`${classifyQuestion(message.content)} DM from ${message.author.tag}: ${message.content}`);
        }
      }

    } catch (err) {
      console.error('OpenAI error (text):', err);
      message.reply('❌ حدث خطأ أثناء محاولة الرد.');
    }
  }
});
client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const feedbackChannel = client.channels.cache.get(process.env.FEEDBACK_LOG_CHANNEL_ID);
    if (feedbackChannel) {
      feedbackChannel.send(`📊 ${interaction.user.tag} rated response: ${interaction.customId === 'like' ? '👍' : '👎'}`);
    }
    await interaction.reply({ content: 'تم تسجيل تقييمك ✅', ephemeral: true });
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'ask-ai') {
    const question = interaction.options.getString('question');
    await interaction.deferReply();

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: question }],
      });

      const reply = response.choices[0].message.content;
      stats.totalReplies++;
      stats.serverQuestions++;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('like').setLabel('👍').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('dislike').setLabel('👎').setStyle(ButtonStyle.Danger)
      );

      await interaction.editReply({ content: reply, components: [row] });

      const logChannel = client.channels.cache.get(process.env.SERVER_LOG_CHANNEL_ID);
      if (logChannel) {
        logChannel.send(`${classifyQuestion(question)} Server question from ${interaction.user.tag}: ${question}`);
      }
    } catch (err) {
      console.error('OpenAI error (slash):', err);
      interaction.editReply('❌ حدث خطأ أثناء محاولة الرد.');
    }
  }

  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: '❌ هذا الأمر فقط لصاحب البوت.', ephemeral: true });
  }

  if (commandName === 'allow-dm') {
    const user = interaction.options.getUser('user');
    allowedDMUsers.add(user.id);
    interaction.reply(`✅ تم السماح لـ ${user.username} بإرسال رسائل خاصة.`);
  }

  if (commandName === 'remove-dm-user') {
    const user = interaction.options.getUser('user');
    allowedDMUsers.delete(user.id);
    interaction.reply(`🗑️ تم حذف ${user.username} من قائمة المسموح لهم.`);
  }

  if (commandName === 'mute-dm') {
    const user = interaction.options.getUser('user');
    mutedDMUsers.add(user.id);
    interaction.reply(`🔇 تم منع ${user.username} من إرسال رسائل خاصة للبوت.`);
  }

  if (commandName === 'list-dm-users') {
    const list = [...allowedDMUsers].map(id => `<@${id}>`).join('\n') || '📭 لا يوجد مستخدمين حالياً.';
    interaction.reply({ content: `📋 قائمة المسموح لهم:\n${list}`, ephemeral: true });
  }

  if (commandName === 'status') {
    const report = `
📊 **Bot Status:**
- Total replies: ${stats.totalReplies}
- Total DMs received: ${stats.totalDMs}
- Unauthorized DM attempts: ${stats.unauthorizedAttempts}
- Server questions: ${stats.serverQuestions}
- Allowed DM users: ${allowedDMUsers.size}
- Muted DM users: ${mutedDMUsers.size}
`;
    interaction.reply({ content: report, ephemeral: true });
  }

  if (commandName === 'commands') {
    interaction.reply({ content: `
📋 **Available Commands:**
- /ask-ai → Ask the AI anything
- /allow-dm → Allow someone to DM the bot
- /remove-dm-user → Remove DM access
- /mute-dm → Block DM access
- /list-dm-users → Show allowed users
- /status → Show bot stats
- /commands → Show this list
`, ephemeral: true });
  }
});
const dailyReport = () => {
  const channel = client.channels.cache.get(process.env.DAILY_LOG_CHANNEL_ID);
  if (channel) {
    const report = `
📅 **Daily Report:**
- Total replies: ${stats.totalReplies}
- Total DMs: ${stats.totalDMs}
- Unauthorized attempts: ${stats.unauthorizedAttempts}
- Server questions: ${stats.serverQuestions}
- Most recent questions:
${Object.entries(stats.lastQuestions).map(([id, q]) => `👤 <@${id}>: ${q}`).join('\n') || 'لا يوجد'}
`;
    channel.send(report);
  }
  stats = {
    totalReplies: 0,
    totalDMs: 0,
    unauthorizedAttempts: 0,
    serverQuestions: 0,
    lastQuestions: {}
  };
};

setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    dailyReport();
  }
}, 60000);

client.once('ready', async () => {
  console.log(`✅ Jbot is online as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName('ask-ai').setDescription('Ask the AI anything')
      .addStringOption(opt => opt.setName('question').setDescription('Your question').setRequired(true)),
    new SlashCommandBuilder().setName('allow-dm').setDescription('Allow user to DM the bot')
      .addUserOption(opt => opt.setName('user').setDescription('User to allow').setRequired(true)),
    new SlashCommandBuilder().setName('remove-dm-user').setDescription('Remove DM access')
      .addUserOption(opt => opt.setName('user').setDescription('User to remove').setRequired(true)),
    new SlashCommandBuilder().setName('mute-dm').setDescription('Mute user from DM')
      .addUserOption(opt => opt.setName('user').setDescription('User to mute').setRequired(true)),
    new SlashCommandBuilder().setName('list-dm-users').setDescription('List allowed DM users'),
    new SlashCommandBuilder().setName('status').setDescription('Show bot stats'),
    new SlashCommandBuilder().setName('commands').setDescription('Show available commands')
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commands registered successfully.');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
});

client.login(process.env.TOKEN);