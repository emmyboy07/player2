const express = require('express');
const axios = require('axios');
const path = require('path');
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
      madplayRes = await axios.get(madplayUrl);
      madplayStreams = Array.isArray(madplayRes.data) ? madplayRes.data : [];
      console.log(`[WATCH] Madplay API Response:`, JSON.stringify(madplayRes.data).substring(0, 500) + '...');
      if (madplayStreams.length && madplayStreams[0].file) {
        let fileUrl = madplayStreams[0].file;
        videoSources.push({
          url: fileUrl,
          label: 'Alpha',
          type: madplayStreams[0].file.includes('.m3u8') ? 'hls' : 'mp4',
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

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
