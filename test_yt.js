const youtubeDl = require('youtube-dl-exec');

async function test() {
  try {
    const query = 'ytsearch1:รักเดียว';
    console.log('Searching via youtube-dl-exec...');
    const info = await youtubeDl(query, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      noCheckCertificate: true,
    });
    
    // For search, info might be a playlist or have entries
    const video = info.entries ? info.entries[0] : info;
    console.log('Title:', video.title);
    console.log('Duration:', video.duration);
    console.log('Original URL:', video.webpage_url);
    
    // Find audio-only formats
    const audioFormats = video.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
    console.log('Found audio formats count:', audioFormats.length);
    
    if (audioFormats.length > 0) {
      audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
      const bestAudio = audioFormats[0];
      console.log('Best audio format URL:', bestAudio.url);
      console.log('Success! Direct stream URL found.');
    } else {
      console.log('No audio formats found.');
    }
  } catch (e) {
    console.error('Error with youtube-dl-exec search:', e);
  }
}

test();
