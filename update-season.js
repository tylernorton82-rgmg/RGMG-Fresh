#!/usr/bin/env node

/**
 * RGMG Season Update Tool v2
 * 
 * Usage:
 *   node update-season.js --season 10 --type regular --players players.csv --goalies goalies.csv
 *   node update-season.js --season 10 --type playoffs --players playersP.csv --goalies goaliesP.csv
 *   node update-season.js --season 10 --images --east "url" --west "url" --playoffs "url"
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

// Season number to season string mapping
const seasonNumberToString = (num) => {
  const startYear = 2015 + num;
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(2)}`;
};

// Season number to file prefix (e.g., 10 -> "2526")
const seasonToFilePrefix = (num) => {
  const startYear = 2015 + num;
  const endYear = startYear + 1;
  return `${String(startYear).slice(2)}${String(endYear).slice(2)}`;
};

// Parse CSV to JSON
const parseCSV = (csvContent) => {
  const lines = csvContent.replace(/\r/g, '').split('\n').filter(line => line.trim());
  
  // Parse header - remove BOM and quotes
  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = headerLine.split(',').map(h => h.replace(/"/g, '').trim());
  
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    // Parse CSV values (handle quoted values)
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    // Create object
    const obj = {};
    headers.forEach((header, idx) => {
      let value = values[idx] || '';
      value = value.replace(/"/g, '');
      
      // Convert numeric fields
      const numericFields = ['GP', 'G', 'A', 'P', '+/-', 'PIM', 'PPP', 'SHp', 'Ht', 'GA', 'TA', 'SOG', 'SB', 'W', 'L', 'T', 'SHA', 'SO'];
      const floatFields = ['S%', 'GAA', 'SV%', 'FO%'];
      
      if (numericFields.includes(header)) {
        obj[header] = parseInt(value) || 0;
      } else if (floatFields.includes(header)) {
        obj[header] = parseFloat(value) || 0;
      } else {
        obj[header] = value;
      }
    });
    
    data.push(obj);
  }
  
  return data;
};

// Rebuild entire bundledData.js from scratch based on what files exist
const rebuildBundledData = (seasonNum, options = {}) => {
  const assetsDir = path.join(process.cwd(), 'assets', 'data');
  
  // Discover all seasons by scanning files
  const allSeasons = [];
  for (let s = 1; s <= 20; s++) {
    const prefix = seasonToFilePrefix(s);
    const regularFile = path.join(assetsDir, `${prefix}r.json`);
    if (fs.existsSync(regularFile)) {
      allSeasons.push(s);
    }
  }
  
  // Make sure current season is included
  if (!allSeasons.includes(seasonNum)) {
    allSeasons.push(seasonNum);
    allSeasons.sort((a, b) => a - b);
  }
  
  // Build the file content
  let content = `// RGMG Analytics - Bundled Data
// All historical data pre-loaded for offline use
// Season images loaded from Google Drive URLs

// Season mapping
export const SEASONS = [
${allSeasons.map(s => `  '${seasonNumberToString(s)}'`).join(',\n')}
];

export const SEASON_TO_NUMBER = {
${allSeasons.map(s => `  '${seasonNumberToString(s)}': ${s}`).join(',\n')}
};

`;

  // Add player imports
  content += `// JSON data imports - Players Regular Season\n`;
  allSeasons.forEach(s => {
    const prefix = seasonToFilePrefix(s);
    const file = path.join(assetsDir, `${prefix}r.json`);
    if (fs.existsSync(file)) {
      content += `const players${prefix}r = require('./assets/data/${prefix}r.json');\n`;
    }
  });
  
  content += `\n// JSON data imports - Players Playoffs\n`;
  allSeasons.forEach(s => {
    const prefix = seasonToFilePrefix(s);
    const file = path.join(assetsDir, `${prefix}p.json`);
    if (fs.existsSync(file)) {
      content += `const players${prefix}p = require('./assets/data/${prefix}p.json');\n`;
    }
  });
  
  content += `\n// JSON data imports - Goalies Regular Season\n`;
  allSeasons.forEach(s => {
    const file = path.join(assetsDir, `goaliesSeason${s}.json`);
    if (fs.existsSync(file)) {
      content += `const goalies${s}r = require('./assets/data/goaliesSeason${s}.json');\n`;
    }
  });
  
  content += `\n// JSON data imports - Goalies Playoffs\n`;
  allSeasons.forEach(s => {
    const file = path.join(assetsDir, `goaliesSeason${s}p.json`);
    if (fs.existsSync(file)) {
      content += `const goalies${s}p = require('./assets/data/goaliesSeason${s}p.json');\n`;
    }
  });
  
  // Build PLAYER_DATA
  content += `\n// Data maps\nexport const PLAYER_DATA = {\n`;
  allSeasons.forEach(s => {
    const prefix = seasonToFilePrefix(s);
    const regularFile = path.join(assetsDir, `${prefix}r.json`);
    const playoffsFile = path.join(assetsDir, `${prefix}p.json`);
    const hasRegular = fs.existsSync(regularFile);
    const hasPlayoffs = fs.existsSync(playoffsFile);
    
    const regularVal = hasRegular ? `players${prefix}r` : '[]';
    const playoffsVal = hasPlayoffs ? `players${prefix}p` : '[]';
    
    content += `  '${seasonNumberToString(s)}': { regular: ${regularVal}, playoffs: ${playoffsVal} },\n`;
  });
  content += `};\n`;
  
  // Build GOALIE_DATA
  content += `\nexport const GOALIE_DATA = {\n`;
  allSeasons.forEach(s => {
    const regularFile = path.join(assetsDir, `goaliesSeason${s}.json`);
    const playoffsFile = path.join(assetsDir, `goaliesSeason${s}p.json`);
    const hasRegular = fs.existsSync(regularFile);
    const hasPlayoffs = fs.existsSync(playoffsFile);
    
    const regularVal = hasRegular ? `goalies${s}r` : '[]';
    const playoffsVal = hasPlayoffs ? `goalies${s}p` : '[]';
    
    content += `  '${seasonNumberToString(s)}': { regular: ${regularVal}, playoffs: ${playoffsVal} },\n`;
  });
  content += `};\n`;
  
  // Build SEASON_IMAGES - load existing first
  const bundledDataPath = path.join(process.cwd(), 'bundledData.js');
  let existingImages = {};
  
  if (fs.existsSync(bundledDataPath)) {
    const existingContent = fs.readFileSync(bundledDataPath, 'utf8');
    // Try to extract existing images
    const imageMatch = existingContent.match(/export const SEASON_IMAGES = \{([\s\S]*?)\};/);
    if (imageMatch) {
      // Parse each season's images
      const imageBlock = imageMatch[1];
      const seasonMatches = imageBlock.matchAll(/(\d+):\s*\{\s*\n?\s*east:\s*'([^']*)'/g);
      for (const match of seasonMatches) {
        const sNum = parseInt(match[1]);
        existingImages[sNum] = { east: match[2] };
      }
      // Get west and playoffs too
      const westMatches = imageBlock.matchAll(/west:\s*'([^']*)'/g);
      const playoffsMatches = imageBlock.matchAll(/playoffs:\s*'([^']*)'/g);
      let idx = 0;
      for (const match of westMatches) {
        const sNum = allSeasons[idx] || idx + 1;
        if (existingImages[sNum]) existingImages[sNum].west = match[1];
        idx++;
      }
      idx = 0;
      for (const match of playoffsMatches) {
        const sNum = allSeasons[idx] || idx + 1;
        if (existingImages[sNum]) existingImages[sNum].playoffs = match[1];
        idx++;
      }
    }
  }
  
  // Update with new images if provided
  if (options.east || options.west || options.playoffs) {
    if (!existingImages[seasonNum]) existingImages[seasonNum] = {};
    if (options.east) existingImages[seasonNum].east = options.east;
    if (options.west) existingImages[seasonNum].west = options.west;
    if (options.playoffs) existingImages[seasonNum].playoffs = options.playoffs;
  }
  
  content += `\n// Season images - loaded from Discord CDN\nexport const SEASON_IMAGES = {\n`;
  allSeasons.forEach(s => {
    const imgs = existingImages[s] || { east: '', west: '', playoffs: '' };
    content += `  ${s}: { \n    east: '${imgs.east || ''}',\n    west: '${imgs.west || ''}',\n    playoffs: '${imgs.playoffs || ''}'\n  },\n`;
  });
  content += `};\n`;
  
  // Add helper functions
  content += `
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
`;

  fs.writeFileSync(bundledDataPath, content);
  console.log('✅ Rebuilt bundledData.js');
};

// Main
const main = () => {
  const season = parseInt(getArg('season'));
  const type = getArg('type'); // 'regular' or 'playoffs'
  const playersFile = getArg('players');
  const goaliesFile = getArg('goalies');
  const imagesOnly = hasFlag('images');
  const eastUrl = getArg('east');
  const westUrl = getArg('west');
  const playoffsUrl = getArg('playoffs');
  
  if (!season) {
    console.error('❌ Missing --season argument');
    console.log('\nUsage:');
    console.log('  node update-season.js --season 10 --type regular --players players.csv --goalies goalies.csv');
    console.log('  node update-season.js --season 10 --type playoffs --players playersP.csv --goalies goaliesP.csv');
    console.log('  node update-season.js --season 10 --images --east "url" --west "url" --playoffs "url"');
    process.exit(1);
  }
  
  const seasonStr = seasonNumberToString(season);
  const filePrefix = seasonToFilePrefix(season);
  const assetsDir = path.join(process.cwd(), 'assets', 'data');
  
  console.log(`\n🏒 RGMG Season Update Tool v2`);
  console.log(`   Season ${season} (${seasonStr})\n`);
  
  // Ensure assets/data directory exists
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
    console.log('📁 Created assets/data directory');
  }
  
  // Handle images only
  if (imagesOnly) {
    console.log('🖼️  Updating season images...');
    rebuildBundledData(season, { east: eastUrl, west: westUrl, playoffs: playoffsUrl });
    console.log('\n✅ Done!');
    return;
  }
  
  if (!type || !['regular', 'playoffs'].includes(type)) {
    console.error('❌ Missing or invalid --type argument (must be "regular" or "playoffs")');
    process.exit(1);
  }
  
  const suffix = type === 'playoffs' ? 'p' : 'r';
  
  // Process players CSV
  if (playersFile) {
    if (!fs.existsSync(playersFile)) {
      console.error(`❌ Players file not found: ${playersFile}`);
      process.exit(1);
    }
    
    console.log(`📄 Processing players (${type})...`);
    const playersCsv = fs.readFileSync(playersFile, 'utf8');
    const playersJson = parseCSV(playersCsv);
    
    const playersOutputFile = path.join(assetsDir, `${filePrefix}${suffix}.json`);
    fs.writeFileSync(playersOutputFile, JSON.stringify(playersJson, null, 2));
    console.log(`   ✅ Created ${path.basename(playersOutputFile)} (${playersJson.length} players)`);
  }
  
  // Process goalies CSV
  if (goaliesFile) {
    if (!fs.existsSync(goaliesFile)) {
      console.error(`❌ Goalies file not found: ${goaliesFile}`);
      process.exit(1);
    }
    
    console.log(`📄 Processing goalies (${type})...`);
    const goaliesCsv = fs.readFileSync(goaliesFile, 'utf8');
    const goaliesJson = parseCSV(goaliesCsv);
    
    const goaliesSuffix = type === 'playoffs' ? 'p' : '';
    const goaliesOutputFile = path.join(assetsDir, `goaliesSeason${season}${goaliesSuffix}.json`);
    fs.writeFileSync(goaliesOutputFile, JSON.stringify(goaliesJson, null, 2));
    console.log(`   ✅ Created ${path.basename(goaliesOutputFile)} (${goaliesJson.length} goalies)`);
  }
  
  // Rebuild bundledData.js
  console.log(`\n📝 Rebuilding bundledData.js...`);
  rebuildBundledData(season, { east: eastUrl, west: westUrl, playoffs: playoffsUrl });
  
  console.log('\n✅ Done! Run "npx expo start --clear" to test.\n');
};

main();
