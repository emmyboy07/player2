const express = require('express');
const axios = require('axios');
const path = require('path');
const url = require('url');
const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

const tmdbApiKey = '1e2d76e7c45818ed61645cb647981e5c';

// Get IMDb ID from TMDB Movie ID
async function getImdbIdFromTmdbMovie(tmdbId) {
  try {
    const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbApiKey}`;
    const tmdbRes = await axios.get(tmdbUrl);
    return tmdbRes.data.imdb_id;
  } catch (e) {
    return null;
  }
}

// Get IMDb ID from TMDB TV ID
async function getImdbIdFromTmdbTv(tmdbId) {
  try {
    const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${tmdbApiKey}`;
    const tmdbRes = await axios.get(tmdbUrl);
    return tmdbRes.data.imdb_id;
  } catch (e) {
    return null;
  }
}

// Get TV Show/Episode Title
async function getTvTitle(seriesId, seasonNumber, episodeNumber) {
  try {
    const showRes = await axios.get(`https://api.themoviedb.org/3/tv/${seriesId}?api_key=${tmdbApiKey}&language=en-US`);
    if (seasonNumber && episodeNumber) {
      const epRes = await axios.get(`https://api.themoviedb.org/3/tv/${seriesId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${tmdbApiKey}&language=en-US`);
      return `${showRes.data.name || 'Series'} - S${seasonNumber}E${episodeNumber}: ${epRes.data.name || 'Episode'}`;
    }
    return showRes.data.name || 'Untitled';
  } catch (e) {
    return 'Untitled';
  }
}

app.get('/watch', async (req, res) => {
  const { type, id } = req.query;
  let imdbId = null, seasonNumber = null, episodeNumber = null, title = 'Untitled';

  console.log(`[WATCH] Request: type=${type}, id=${id}`);

  try {
    let madplayRes, madplayStreams = [];
    let seriesId, madplayUrl = '';
    let videoSources = [];
    let videoUrl = null;

    if (type === 'tv') {
      const parts = id.split('/');
      seriesId = parts[0];
      if (parts.length === 3) {
        seasonNumber = parts[1];
        episodeNumber = parts[2];
      }
      madplayUrl = `https://madplay.site/api/playsrc?id=${seriesId}&season=${seasonNumber || 1}&episode=${episodeNumber || 1}`;
    } else {
      const madplayId = id || '811941';
      madplayUrl = `https://madplay.site/api/playsrc?id=${madplayId}`;
    }

    // Fetch Madplay (Alpha)
    try {
      console.log(`[WATCH] Madplay API Request: ${madplayUrl}`);
      madplayRes = await axios.get(madplayUrl, {
        headers: {
          'origin': 'https://uembed.site',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
          'accept': '*/*',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
          'cache-control': 'no-cache',
          'pragma': 'no-cache',
          // You can add more headers if needed
        }
      });
      madplayStreams = Array.isArray(madplayRes.data) ? madplayRes.data : [];
      console.log(`[WATCH] Madplay API Response:`, JSON.stringify(madplayRes.data).substring(0, 500) + '...');
      if (madplayStreams.length && madplayStreams[0].file) {
        let fileUrl = madplayStreams[0].file;
        // If fileUrl is a madplay.site/api/playsrc/hls?url=... link, extract the ?url= part
        const match = fileUrl.match(/^https?:\/\/madplay\.site\/api\/playsrc\/hls\?url=([^&]+)/);
        if (match) {
          fileUrl = decodeURIComponent(match[1]);
        }
        videoSources.push({
          url: fileUrl,
          label: 'Alpha',
          type: fileUrl.includes('.m3u8') ? 'hls' : 'mp4',
        });
        videoUrl = fileUrl;
      }
    } catch (err) {
      console.log(`[WATCH] Madplay API failed: ${err.message}`);
    }

    // Get title as before
    if (type === 'movie') {
      const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${id}?api_key=1e2d76e7c45818ed61645cb647981e5c&language=en-US`);
      imdbId = tmdbRes.data.imdb_id;
      title = tmdbRes.data.title || tmdbRes.data.name || 'Untitled';
    } else if (type === 'tv') {
      const parts = id.split('/');
      const seriesId = parts[0];
      if (parts.length === 3) {
        seasonNumber = parts[1];
        episodeNumber = parts[2];
      }
      imdbId = await getImdbIdFromTmdbTv(seriesId);
      title = await getTvTitle(seriesId, seasonNumber, episodeNumber);
    }

    // Fetch subtitles from wyzie.ru
    let wyzieSubtitles = [];
    if (imdbId) {
      try {
        console.log(`[SUBTITLES] Fetching subtitles for IMDb ID: ${imdbId}`);
        const subRes = await axios.get(`https://sub.wyzie.ru/search?id=${imdbId}&encoding=utf-8&format=srt&source=all`);
        wyzieSubtitles = Array.isArray(subRes.data) ? subRes.data : [];
        console.log(`[SUBTITLES] Found ${wyzieSubtitles.length} subtitles for IMDb ID: ${imdbId}`);
      } catch (e) {
        console.error(`[SUBTITLES] Failed to fetch subtitles for IMDb ID: ${imdbId}`, e.message);
        wyzieSubtitles = [];
      }
    } else {
      console.warn(`[SUBTITLES] No IMDb ID found, skipping subtitle fetch.`);
    }

    // Log outgoing response
    console.log(`[WATCH] Render player with videoUrl: ${videoUrl}, title: ${title}`);
    res.render("player", {
      videoUrl,
      videoSources: videoSources.length ? videoSources : [{url: videoUrl, label: 'Alpha', type: 'mp4'}],
      title,
      subtitleUrl: '',
      wyzieSubtitles,
      tmdbId: id,
    });

    console.log(`🎬 Playing: ${title}`);
    console.log(`🔗 Video URL: ${videoUrl}`);

  } catch (err) {
    console.error(`[WATCH] Error:`, err.message);
    res.status(500).send('Failed to fetch video source.');
  }
});

// Proxy HLS stream from Madplay
app.get('/proxy/hls', async (req, res) => {
  const { url: targetUrl } = req.query;
  if (!targetUrl) return res.status(400).send('Missing url parameter');

  let fetchUrl = targetUrl;
  if (fetchUrl.startsWith('/')) {
    // Do NOT encode again, just append as-is
    fetchUrl = 'https://madplay.site/api/playsrc/hls?url=' + fetchUrl;
  }

  try {
    const response = await axios.get(fetchUrl, {
      responseType: 'arraybuffer',
      headers: {
        'origin': 'https://uembed.site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        'accept': '*/*',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
      }
    });

    // Check if it's a playlist
    const contentType = response.headers['content-type'];
    if (contentType && contentType.includes('application/vnd.apple.mpegurl') || targetUrl.endsWith('.m3u8')) {
      let playlist = response.data.toString('utf8');
      // Rewrite all URLs in the playlist to go through the proxy
      playlist = playlist.replace(
        /^(?!#)(.+)$/gm,
        (line) => {
          // Ignore comments and empty lines
          if (line.startsWith('#') || !line.trim()) return line;
          // Resolve relative URLs
          const resolved = url.resolve(targetUrl, line.trim());
          return `/proxy/hls?url=${encodeURIComponent(resolved)}`;
        }
      );
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(playlist);
    } else {
      // For segments, just pipe as before
      res.setHeader('Access-Control-Allow-Origin', '*');
      Object.entries(response.headers).forEach(([key, value]) => {
        if (!/^access-control-/i.test(key)) res.setHeader(key, value);
      });
      res.send(Buffer.from(response.data));
    }
  } catch (err) {
    res.status(500).send('Failed to proxy HLS stream.');
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
