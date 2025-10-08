const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const OpenAI = require('openai');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ✅ تسجيل أوامر سلاش
const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('اسأل Jbot سؤالاً ذكياً')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('اكتب سؤالك')
        .setRequired(true)
    )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`✅ Jbot is online as ${client.user.tag}`);

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ Slash commands registered successfully');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
});

// ✅ الرد على أمر /ask
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ask') {
    const prompt = interaction.options.getString('prompt');

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }]
      });

      await interaction.reply(response.choices[0].message.content);
    } catch (error) {
      console.error('❌ OpenAI Error:', error.message);
      await interaction.reply('حدث خطأ أثناء التواصل مع OpenAI.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
