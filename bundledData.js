// RGMG Analytics - Bundled Data
// All historical data pre-loaded for offline use
// Season images loaded from Google Drive URLs

// Season mapping
export const SEASONS = [
  '2016-17',
  '2017-18',
  '2018-19',
  '2019-20',
  '2020-21',
  '2021-22',
  '2022-23',
  '2023-24',
  '2024-25',
  '2025-26',
  '2026-27',
  '2027-28',
  '2028-29'
];

export const SEASON_TO_NUMBER = {
  '2016-17': 1,
  '2017-18': 2,
  '2018-19': 3,
  '2019-20': 4,
  '2020-21': 5,
  '2021-22': 6,
  '2022-23': 7,
  '2023-24': 8,
  '2024-25': 9,
  '2025-26': 10,
  '2026-27': 11,
  '2027-28': 12,
  '2028-29': 13
};

// JSON data imports - Players Regular Season
const players1617r = require('./assets/data/1617r.json');
const players1718r = require('./assets/data/1718r.json');
const players1819r = require('./assets/data/1819r.json');
const players1920r = require('./assets/data/1920r.json');
const players2021r = require('./assets/data/2021r.json');
const players2122r = require('./assets/data/2122r.json');
const players2223r = require('./assets/data/2223r.json');
const players2324r = require('./assets/data/2324r.json');
const players2425r = require('./assets/data/2425r.json');
const players2526r = require('./assets/data/2526r.json');
const players2627r = require('./assets/data/2627r.json');
const players2728r = require('./assets/data/2728r.json');
const players2829r = require('./assets/data/2829r.json');

// JSON data imports - Players Playoffs
const players1617p = require('./assets/data/1617p.json');
const players1718p = require('./assets/data/1718p.json');
const players1819p = require('./assets/data/1819p.json');
const players1920p = require('./assets/data/1920p.json');
const players2021p = require('./assets/data/2021p.json');
const players2122p = require('./assets/data/2122p.json');
const players2223p = require('./assets/data/2223p.json');
const players2324p = require('./assets/data/2324p.json');
const players2425p = require('./assets/data/2425p.json');
const players2526p = require('./assets/data/2526p.json');
const players2627p = require('./assets/data/2627p.json');

// JSON data imports - Goalies Regular Season
const goalies1r = require('./assets/data/goaliesSeason1.json');
const goalies2r = require('./assets/data/goaliesSeason2.json');
const goalies3r = require('./assets/data/goaliesSeason3.json');
const goalies4r = require('./assets/data/goaliesSeason4.json');
const goalies5r = require('./assets/data/goaliesSeason5.json');
const goalies6r = require('./assets/data/goaliesSeason6.json');
const goalies7r = require('./assets/data/goaliesSeason7.json');
const goalies8r = require('./assets/data/goaliesSeason8.json');
const goalies9r = require('./assets/data/goaliesSeason9.json');
const goalies10r = require('./assets/data/goaliesSeason10.json');
const goalies11r = require('./assets/data/goaliesSeason11.json');
const goalies12r = require('./assets/data/goaliesSeason12.json');
const goalies13r = require('./assets/data/goaliesSeason13.json');

// JSON data imports - Goalies Playoffs
const goalies1p = require('./assets/data/goaliesSeason1p.json');
const goalies2p = require('./assets/data/goaliesSeason2p.json');
const goalies3p = require('./assets/data/goaliesSeason3p.json');
const goalies4p = require('./assets/data/goaliesSeason4p.json');
const goalies5p = require('./assets/data/goaliesSeason5p.json');
const goalies6p = require('./assets/data/goaliesSeason6p.json');
const goalies7p = require('./assets/data/goaliesSeason7p.json');
const goalies8p = require('./assets/data/goaliesSeason8p.json');
const goalies9p = require('./assets/data/goaliesSeason9p.json');
const goalies10p = require('./assets/data/goaliesSeason10p.json');
const goalies11p = require('./assets/data/goaliesSeason11p.json');

// Data maps
export const PLAYER_DATA = {
  '2016-17': { regular: players1617r, playoffs: players1617p },
  '2017-18': { regular: players1718r, playoffs: players1718p },
  '2018-19': { regular: players1819r, playoffs: players1819p },
  '2019-20': { regular: players1920r, playoffs: players1920p },
  '2020-21': { regular: players2021r, playoffs: players2021p },
  '2021-22': { regular: players2122r, playoffs: players2122p },
  '2022-23': { regular: players2223r, playoffs: players2223p },
  '2023-24': { regular: players2324r, playoffs: players2324p },
  '2024-25': { regular: players2425r, playoffs: players2425p },
  '2025-26': { regular: players2526r, playoffs: players2526p },
  '2026-27': { regular: players2627r, playoffs: players2627p },
  '2027-28': { regular: players2728r, playoffs: [] },
  '2028-29': { regular: players2829r, playoffs: [] },
};

export const GOALIE_DATA = {
  '2016-17': { regular: goalies1r, playoffs: goalies1p },
  '2017-18': { regular: goalies2r, playoffs: goalies2p },
  '2018-19': { regular: goalies3r, playoffs: goalies3p },
  '2019-20': { regular: goalies4r, playoffs: goalies4p },
  '2020-21': { regular: goalies5r, playoffs: goalies5p },
  '2021-22': { regular: goalies6r, playoffs: goalies6p },
  '2022-23': { regular: goalies7r, playoffs: goalies7p },
  '2023-24': { regular: goalies8r, playoffs: goalies8p },
  '2024-25': { regular: goalies9r, playoffs: goalies9p },
  '2025-26': { regular: goalies10r, playoffs: goalies10p },
  '2026-27': { regular: goalies11r, playoffs: goalies11p },
  '2027-28': { regular: goalies12r, playoffs: [] },
  '2028-29': { regular: goalies13r, playoffs: [] },
};

// Season images - loaded from Discord CDN
export const SEASON_IMAGES = {
  1: { 
    east: 'https://cdn.discordapp.com/attachments/1374612052806733895/1390133556151320596/Screenshot_2025-07-02_205341.png?ex=696e2983&is=696cd803&hm=210cc2b8a68a8ddffc0685d7cc6b1c0a7457a23b73be665d4e3c96c105716b8e&',
    west: 'https://cdn.discordapp.com/attachments/1374612052806733895/1390133575604768919/Screenshot_2025-07-02_205357.png?ex=696e2987&is=696cd807&hm=c57fc16a7692e6d2f3e376f0a5f43fae19eaadeac4bb2a45abdce3d340ad0f1b&',
    playoffs: 'https://cdn.discordapp.com/attachments/1374612052806733895/1390815002314801172/Screenshot_2025-07-04_180053.png?ex=696e0128&is=696cafa8&hm=b88ea7a08b8d6df7dad037d0e52cc88db90541afc6ed3cb952e3ecd1c8b6078d&'
  },
  2: { 
    east: 'https://cdn.discordapp.com/attachments/1393417858842628146/1396976436845478009/Screenshot_2025-07-21_175845.png?ex=696e01f1&is=696cb071&hm=d9160c9e77bc212a26515444eb511b74a57ab6efee0dacf08b300b4ee17c27d9&',
    west: 'https://cdn.discordapp.com/attachments/1393417858842628146/1396976459129684109/Screenshot_2025-07-21_175902.png?ex=696e01f6&is=696cb076&hm=df8f1a5f8d81bbd9099220139595fd165d007053c56594fd4915fa5d83b9131e&',
    playoffs: 'https://cdn.discordapp.com/attachments/1393417858842628146/1397673990398546143/SPOILER_Screenshot_2025-07-23_161714.png?ex=696de896&is=696c9716&hm=3c259a0d6e1fe9b02d6a2c0e17d7202fbb8d2b4700689f864b3172b40ef0dc55&'
  },
  3: { 
    east: 'https://media.discordapp.net/attachments/1399157686108426251/1403548331355148409/Screenshot_2025-08-08_211809.png?ex=696e2f7e&is=696cddfe&hm=47312bbb70609a524c6a10561d91d2a6182753037f7e6eab06691e9bb5c6a38e&=&format=webp&quality=lossless&width=1514&height=938',
    west: 'https://media.discordapp.net/attachments/1399157686108426251/1403548364632756367/Screenshot_2025-08-08_211822.png?ex=696e2f86&is=696cde06&hm=8bbc5595cd767f0481967790de061d2f5c1dfad1c264d5477e1145dde0bba485&=&format=webp&quality=lossless&width=1512&height=938',
    playoffs: 'https://cdn.discordapp.com/attachments/1399157686108426251/1403893254784684134/SPOILER_Screenshot_2025-08-09_200947.png?ex=696e1f3b&is=696ccdbb&hm=857b967fcf84af853c904628946aff921d63be576412c4f56d4b709eebc417bb&'
  },
  4: { 
    east: 'https://cdn.discordapp.com/attachments/1404550486308163765/1411392565227552871/Screenshot_2025-08-30_123724.png?ex=696e60c1&is=696d0f41&hm=88eb29618a3cf0f4d313786dd38cd84dc87465744c103aeb75f79d149b27ff99&',
    west: 'https://cdn.discordapp.com/attachments/1404550486308163765/1411392580381573221/Screenshot_2025-08-30_123741.png?ex=696e60c5&is=696d0f45&hm=c90658cb235dcb33ee7b77ba8be15e824f0ded437d1ad19bccabf6d884521a24&',
    playoffs: 'https://cdn.discordapp.com/attachments/1404550486308163765/1412156198303694900/Screenshot_2025-09-01_152410.png?ex=696ddc32&is=696c8ab2&hm=4510b9145f17124395a0f17823d7e1ca2fa1d5d935518d4579245316c96f2fed&'
  },
  5: { 
    east: 'https://cdn.discordapp.com/attachments/1413314348159602698/1417529223794524160/Screenshot_2025-09-16_110707.png?ex=696e4a77&is=696cf8f7&hm=0dd34dd90a036782cda40117547f2671600b32987234d7f7652f1d4e0829caa7&',
    west: 'https://cdn.discordapp.com/attachments/1413314348159602698/1417529239812440084/Screenshot_2025-09-16_110732.png?ex=696e4a7b&is=696cf8fb&hm=83d70eb9512cd6945dc42b75c7a90fa41aabad6bc98b1503ed68252bb66e04e6&',
    playoffs: 'https://cdn.discordapp.com/attachments/1413314348159602698/1418001907804537027/SPOILER_Screenshot_2025-09-17_183208.png?ex=696e0870&is=696cb6f0&hm=2503b2d839ea259c297ee7c0e547a2775efbd574784b28d1c2e681f10a784fff&'
  },
  6: { 
    east: 'https://media.discordapp.net/attachments/1418027920030437519/1426949520037777458/Screenshot_2025-10-12_110308.png?ex=696e48cd&is=696cf74d&hm=b863a64a194cfa7c4cf16450b095a999e40bf876ee7850c2f6855372800a3d44&=&format=webp&quality=lossless&width=1517&height=941',
    west: 'https://cdn.discordapp.com/attachments/1418027920030437519/1426949533996286145/Screenshot_2025-10-12_110320.png?ex=696e48d0&is=696cf750&hm=31b4b137986f81135fddcd30ea378b912695ee7339ed6a9760ef43933411cc18&',
    playoffs: 'https://cdn.discordapp.com/attachments/1418027920030437519/1428163669610598530/SPOILER_Screenshot_2025-10-15_193148.png?ex=696e1650&is=696cc4d0&hm=5cbfc076a64198138ba9f6dc72723bd4548a6c9ca843e32957a5d64e7d27270b&'
  },
  7: { 
    east: 'https://media.discordapp.net/attachments/1432145565285879969/1436076179407896828/Screenshot_2025-11-06_142218.png?ex=696dde6a&is=696c8cea&hm=4d607acc358d871a702f16cf70ba55731ee4dd0f552d33087330d4f465839e3b&=&format=webp&quality=lossless&width=1517&height=939',
    west: 'https://media.discordapp.net/attachments/1432145565285879969/1436076192892588165/Screenshot_2025-11-06_142248.png?ex=696dde6d&is=696c8ced&hm=74aee127d34b13837faa39a443a23882dbc2a4f632abb79f690330fc4f8e1855&=&format=webp&quality=lossless&width=1512&height=942',
    playoffs: 'https://cdn.discordapp.com/attachments/1432145565285879969/1437206692831039811/SPOILER_Screenshot_2025-11-09_172534.png?ex=696e06c9&is=696cb549&hm=83f9f802118c40cf6a77585ceead39ea0072029acf442b56ee9e632b1b66539c&'
  },
  8: { 
    east: 'https://cdn.discordapp.com/attachments/1437660844010770524/1444098868974321674/Screenshot_2025-11-28_175140.png?ex=696e0d20&is=696cbba0&hm=93cac2822b9f1732f551d87dd548acac8016572feff416f2515e8924a63e7c06&',
    west: 'https://cdn.discordapp.com/attachments/1437660844010770524/1444098882433716266/Screenshot_2025-11-28_175150.png?ex=696e0d23&is=696cbba3&hm=98f9ff434fa558e5f930698d4fb45a1f974e170f60ee0bfb4570c69e18963b51&',
    playoffs: 'https://cdn.discordapp.com/attachments/1437660844010770524/1444830596688777317/Screenshot_2025-11-30_182023.png?ex=696e1399&is=696cc219&hm=96a4e6776d864740071eb97cb0ffc2c768c97d9633d9e6574a14176074e24943&'
  },
  9: { 
    east: 'https://cdn.discordapp.com/attachments/1449241362544332933/1452016004723904635/Screenshot_2025-12-20_140834.png?ex=696dd988&is=696c8808&hm=e70588777c2ce6fcd0ebbc4166d666ee4b2e33f42cc94ad8525b3fbbde3c3eb1&',
    west: 'https://cdn.discordapp.com/attachments/1449241362544332933/1452016025112547440/Screenshot_2025-12-20_140846.png?ex=696dd98d&is=696c880d&hm=3d9a451a5d1c3827609b4f6c284244959048609099f689c8c1c675aa5a5c64fe&',
    playoffs: 'https://media.discordapp.net/attachments/1449241362544332933/1457543364273508392/Screenshot_2026-01-04_201536.png?ex=696e2ec9&is=696cdd49&hm=21dc12df95a504409851db9bd266350168dcf49b0acc591d9dec72b35b152c28&=&format=webp&quality=lossless&width=1500&height=827'
  },
  10: { 
    east: 'https://media.discordapp.net/attachments/1459049171070877767/1463311649527169108/Screenshot_2026-01-20_181726.png?ex=69715eac&is=69700d2c&hm=e4f185ebb9df70aeca99f63842151253d413ea9b0e57194939f3c780dbaa081e&=&format=webp&quality=lossless&width=1518&height=938',
    west: 'https://media.discordapp.net/attachments/1459049171070877767/1463311666060984361/Screenshot_2026-01-20_181732.png?ex=69715eb0&is=69700d30&hm=2d77048be10b31a38137b1311626d9cac1377c9c3c9e1ce6f1cbaabe26844282&=&format=webp&quality=lossless&width=1518&height=939',
    playoffs: ''
  },
  11: { 
    east: '',
    west: '',
    playoffs: ''
  },
  12: { 
    east: '',
    west: '',
    playoffs: ''
  },
  13: { 
    east: '',
    west: '',
    playoffs: ''
  },
};

// Helper to get all data for a specific season
export const getSeasonData = (season, type = 'regular') => {
  return {
    players: PLAYER_DATA[season]?.[type] || [],
    goalies: GOALIE_DATA[season]?.[type] || [],
  };
};

// Helper to get images for a season number (1-9)
export const getSeasonImages = (seasonNumber) => {
  return SEASON_IMAGES[seasonNumber] || null;
};

// Check if bundled data is available
export const hasBundledData = () => true;
