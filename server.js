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
    if (type === 'tv') {
      const parts = id.split('/');
      const seriesId = parts[0];
      if (parts.length === 3) {
        seasonNumber = parts[1];
        episodeNumber = parts[2];
        const sonixUrl = `https://sonix-movies.vercel.app/api/tv/download?id=${seriesId}&season=${seasonNumber}&episode=${episodeNumber}`;
        console.log(`[WATCH] Sonix API Request: ${sonixUrl}`);
        sonixRes = await axios.get(sonixUrl);
        console.log(`[WATCH] Sonix API Response:`, JSON.stringify(sonixRes.data).substring(0, 500) + '...');
      } else {
        const sonixUrl = `https://sonix-movies.vercel.app/api/tv/download?id=${seriesId}&season=1&episode=1`;
        console.log(`[WATCH] Sonix API Request: ${sonixUrl}`);
        sonixRes = await axios.get(sonixUrl);
        console.log(`[WATCH] Sonix API Response:`, JSON.stringify(sonixRes.data).substring(0, 500) + '...');
      }
      sonixStreams = sonixRes.data.streams || [];
    } else {
      const sonixId = id || '1233413';
      const sonixUrl = `https://sonix-movies.vercel.app/api/movies/download?id=${sonixId}`;
      console.log(`[WATCH] Sonix API Request: ${sonixUrl}`);
      sonixRes = await axios.get(sonixUrl);
      console.log(`[WATCH] Sonix API Response:`, JSON.stringify(sonixRes.data).substring(0, 500) + '...');
      sonixStreams = sonixRes.data.streams || [];
    }

    // Map qualities from Sonix API response
    const videoSources = sonixStreams.map(stream => ({
      url: stream.url,
      label: stream.resolutions || stream.label || stream.format || 'Auto',
      type: stream.format && stream.format.toLowerCase() === 'mp4' ? 'mp4'
           : (stream.url && stream.url.includes('.m3u8') ? 'hls' : 'mp4'),
      size: stream.size,
      duration: stream.duration,
      codecName: stream.codecName,
    }));

    // Pick the highest resolution stream (last in array, or first)
    const mainStream = sonixStreams[sonixStreams.length - 1] || sonixStreams[0];
    const sonixVideoUrl = mainStream?.url;

    // Fallback to your original logic if needed
    let videoUrl = sonixVideoUrl;

    // Get title as before
    let wyzieSubtitles = [];
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
      // Fetch all subtitles from wyzie.ru for this episode
      if (imdbId && seasonNumber && episodeNumber) {
        const wyzieUrl = `https://sub.wyzie.ru/api/subs?imdb=${imdbId}&season=${seasonNumber}&episode=${episodeNumber}`;
        try {
          const wyzieRes = await axios.get(wyzieUrl, { timeout: 10000 });
          wyzieSubtitles = Array.isArray(wyzieRes.data) ? wyzieRes.data : [];
        } catch (e) {
          wyzieSubtitles = [];
        }
      }
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

    // Fallback logic here (e.g., HLS passthrough)
    if (!videoUrl) {
      return res.status(404).send('Video source not found.');
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
      sonixSubtitles: allSubtitles
    });

    console.log(`🎬 Playing: ${title}`);
    console.log(`🔗 Video URL: ${videoUrl}`);

  } catch (err) {
    console.error(`[WATCH] Error:`, err.message);
    res.status(500).send('Failed to fetch video source.');
  }
});

app.get('/api/subtitles', async (req, res) => {
  const { url } = req.query;
  console.log(`[SUBTITLES] Request: url=${url}`);
  try {
    if (!url || !/^https:\/\/(cacdn\.hakunaymatata\.com|sub\.wyzie\.ru)\//.test(url)) {
      console.log(`[SUBTITLES] Invalid URL`);
      return res.status(400).json({ error: 'Invalid URL' });
    }
    const response = await axios.get(url, { timeout: 10000, responseType: 'text' });
    console.log(`[SUBTITLES] Response: ${response.status} (${response.headers['content-type']})`);
    res.set('Access-Control-Allow-Origin', '*');
    res.type('text/plain').send(response.data);
  } catch (err) {
    console.error(`[SUBTITLES] Error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch subtitles', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
