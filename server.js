const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

app.get('/watch', async (req, res) => {
  const { type, id } = req.query;
  let imdbId = null, seasonNumber = null, episodeNumber = null, title = 'Untitled';

  // Log incoming request
  console.log(`[WATCH] Request: type=${type}, id=${id}`);

  try {
    let sonixRes, sonixStreams = [];
    let seriesId, seasonNumber, episodeNumber;
    if (type === 'tv') {
      const parts = id.split('/');
      seriesId = parts[0];
      if (parts.length === 3) {
        seasonNumber = parts[1];
        episodeNumber = parts[2];
      }
      try {
        const sonixUrl = `https://sonix-movies.vercel.app/api/tv/download?id=${seriesId}&season=${seasonNumber || 1}&episode=${episodeNumber || 1}`;
        console.log(`[WATCH] Sonix API Request: ${sonixUrl}`);
        sonixRes = await axios.get(sonixUrl);
        console.log(`[WATCH] Sonix API Response:`, JSON.stringify(sonixRes.data).substring(0, 500) + '...');
        sonixStreams = sonixRes.data.streams || [];
      } catch (err) {
        console.log(`[WATCH] Sonix API failed: ${err.message}`);
      }
    } else {
      const sonixId = id || '1233413';
      try {
        const sonixUrl = `https://sonix-movies.vercel.app/api/movies/download?id=${sonixId}`;
        console.log(`[WATCH] Sonix API Request: ${sonixUrl}`);
        sonixRes = await axios.get(sonixUrl);
        console.log(`[WATCH] Sonix API Response:`, JSON.stringify(sonixRes.data).substring(0, 500) + '...');
        sonixStreams = sonixRes.data.streams || [];
      } catch (err) {
        console.log(`[WATCH] Sonix API failed: ${err.message}`);
      }
    }

    // Map qualities from Sonix API response
    let videoSources = sonixStreams.map(stream => ({
      url: stream.url,
      label: stream.resolutions || stream.label || stream.quality || stream.format || 'Auto',
      type: stream.format && stream.format.toLowerCase() === 'mp4' ? 'mp4'
           : (stream.url && stream.url.includes('.m3u8') ? 'hls' : (stream.format || 'mp4')),
      size: stream.size,
      duration: stream.duration,
      codecName: stream.codecName,
    }));

    // Pick the highest resolution stream (last in array, or first)
    const mainStream = sonixStreams[sonixStreams.length - 1] || sonixStreams[0];
    let videoUrl = mainStream?.url;

    // --- Fallback to /movies/download3 or /tv/download if no videoUrl ---
    if (!videoUrl) {
      try {
        if (type === 'movie') {
          const fallbackUrl = `https://sonix-movies.vercel.app/api/movies/download3?id=${id}`;
          console.log(`[WATCH] Fallback Sonix API Request: ${fallbackUrl}`);
          const fallbackRes = await axios.get(fallbackUrl);
          const fallbackStreams = fallbackRes.data.streams || [];
          if (fallbackStreams.length) {
            videoSources = fallbackStreams.map(stream => ({
              url: stream.url,
              label: stream.quality || stream.format || 'Auto',
              type: stream.format && stream.format.toLowerCase() === 'mp4' ? 'mp4'
                   : (stream.url && stream.url.includes('.m3u8') ? 'hls' : (stream.format || 'mp4')),
              size: stream.size,
            }));
            videoUrl = fallbackStreams[fallbackStreams.length - 1]?.url || fallbackStreams[0]?.url;
          }
        } else if (type === 'tv' && seriesId && seasonNumber && episodeNumber) {
          const fallbackUrl = `https://sonix-movies.vercel.app/api/tv/downloa?id=${seriesId}&season=${seasonNumber}&episode=${episodeNumber}`;
          console.log(`[WATCH] Fallback Sonix TV API Request: ${fallbackUrl}`);
          const fallbackRes = await axios.get(fallbackUrl);
          const fallbackStreams = fallbackRes.data.streams || [];
          if (fallbackStreams.length) {
            videoSources = fallbackStreams.map(stream => ({
              url: stream.url,
              label: stream.quality || stream.format || 'Auto',
              type: stream.format && stream.format.toLowerCase() === 'mp4' ? 'mp4'
                   : (stream.url && stream.url.includes('.m3u8') ? 'hls' : (stream.format || 'mp4')),
              size: stream.size,
            }));
            videoUrl = fallbackStreams[fallbackStreams.length - 1]?.url || fallbackStreams[0]?.url;
          }
        }
      } catch (e) {
        console.log(`[WATCH] Fallback Sonix-movies fallback failed`);
      }
    }

    // --- Fallback to HLS passthrough if still no videoUrl ---
    if (!videoUrl) {
      try {
        const encodedId = encodeURIComponent(id);
        const destination = `https://tom.autoembed.cc/api/getVideoSource?type=${type}&id=${encodedId}`;
        const passthroughUrl = `https://pass-through.arlen.icu/?destination=${encodeURIComponent(destination)}`;
        const response = await axios.get(passthroughUrl, {
          headers: {
            'x-origin': 'https://tom.autoembed.cc',
            'x-referer': 'https://tom.autoembed.cc'
          }
        });
        videoUrl = response.data.videoSource;
        if (videoUrl) {
          videoSources = [{ url: videoUrl, label: 'Auto', type: 'mp4' }];
        }
      } catch (e) {
        console.log(`[WATCH] HLS passthrough fallback failed`);
      }
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
      // Get IMDb ID for the series
      const externalRes = await axios.get(`https://api.themoviedb.org/3/tv/${seriesId}/external_ids?api_key=1e2d76e7c45818ed61645cb647981e5c`);
      imdbId = externalRes.data.imdb_id;
      // Get episode title if possible
      if (seasonNumber && episodeNumber) {
        const epRes = await axios.get(`https://api.themoviedb.org/3/tv/${seriesId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=1e2d76e7c45818ed61645cb647981e5c&language=en-US`);
        const showRes = await axios.get(`https://api.themoviedb.org/3/tv/${seriesId}?api_key=1e2d76e7c45818ed61645cb647981e5c&language=en-US`);
        title = `${showRes.data.name || 'Series'} - S${seasonNumber}E${episodeNumber}: ${epRes.data.name || 'Episode'}`;
      } else {
        const showRes = await axios.get(`https://api.themoviedb.org/3/tv/${seriesId}?api_key=1e2d76e7c45818ed61645cb647981e5c&language=en-US`);
        title = showRes.data.name || 'Untitled';
      }
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

    // If you want to keep your old fallback, you can check if sonixVideoUrl exists
    if (!videoUrl) {
      const encodedId = encodeURIComponent(id);
      const destination = `https://tom.autoembed.cc/api/getVideoSource?type=${type}&id=${encodedId}`;
      const passthroughUrl = `https://pass-through.arlen.icu/?destination=${encodeURIComponent(destination)}`;
      const response = await axios.get(passthroughUrl, {
        headers: {
          'x-origin': 'https://tom.autoembed.cc',
          'x-referer': 'https://tom.autoembed.cc'
        }
      });
      videoUrl = response.data.videoSource;
    }

    // Merge Sonix and Wyzie subtitles (if any)
    let allSubtitles = [];
    if (mainStream?.subtitles && Array.isArray(mainStream.subtitles)) {
      allSubtitles = mainStream.subtitles.map(sub => ({
        url: sub.url,
        lan: sub.lan || sub.language || '',
        lanName: sub.lanName || sub.display || '',
        flagUrl: sub.flagUrl || '',
        isHearingImpaired: sub.isHearingImpaired || false,
        source: 'sonix'
      }));
    }
    if (wyzieSubtitles.length) {
      allSubtitles = allSubtitles.concat(
        wyzieSubtitles.map(sub => ({
          url: sub.url,
          lan: sub.language,
          lanName: sub.display,
          flagUrl: sub.flagUrl,
          isHearingImpaired: sub.isHearingImpaired,
          source: 'wyzie'
        }))
      );
    }

    // Log outgoing response
    console.log(`[WATCH] Render player with videoUrl: ${videoUrl}, title: ${title}`);
    res.render("player", {
      videoUrl,
      videoSources: videoSources.length ? videoSources : [{url: videoUrl, label: 'Auto', type: 'mp4'}],
      title,
      subtitleUrl: '',
      wyzieSubtitles, // pass subtitles to the view
      tmdbId: id,
    });

    console.log(`🎬 Playing: ${title}`);
    console.log(`🔗 Video URL: ${videoUrl}`);

  } catch (err) {
    console.error(`[WATCH] Error:`, err.message);
    res.status(500).send('Failed to fetch video source.');
  }
});

const tmdbApiKey = '1e2d76e7c45818ed61645cb647981e5c'; // Replace with your TMDB API key

// Get IMDb ID from TMDB ID
async function getImdbIdFromTmdb(tmdbId) {
  try {
    const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbApiKey}`;
    const tmdbRes = await axios.get(tmdbUrl);
    return tmdbRes.data.imdb_id;
  } catch (e) {
    return null;
  }
}

// Subtitle API endpoint
app.get('/subtitles', async (req, res) => {
  const { tmdb } = req.query;
  if (!tmdb) return res.json([]);
  const imdbId = await getImdbIdFromTmdb(tmdb);
  if (!imdbId) return res.json([]);
  try {
    const subRes = await axios.get(`https://sub.wyzie.ru/search?id=${imdbId}&encoding=utf-8&format=srt&source=all`);
    res.json(subRes.data);
  } catch (e) {
    res.json([]);
  }
});

// Improved proxy for subtitle files with fast streaming and caching headers
app.get('/proxy-subtitle', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).send('Invalid URL');
  try {
    // Set cache headers for faster repeat loads
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');
    // Add a User-Agent header to mimic a browser
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 10000,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Accept': 'text/vtt, text/plain, */*'
      }
    });
    res.set('Content-Type', response.headers['content-type'] || 'text/vtt');
    response.data.pipe(res);
  } catch (e) {
    console.error('[PROXY SUBTITLE ERROR]', e.message, url);
    res.status(500).send('Failed to fetch subtitle');
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
