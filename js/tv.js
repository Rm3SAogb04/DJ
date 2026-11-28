(function (root) {
  'use strict';

  function createRoomTV(options) {
    let youtubeApiPromise = null;
    let player = null;
    let queue = [];
    let titles = [];
    let index = 0;
    let request = 0;
    let playing = false;
    let interrupted = null;
    let interruptedByOtherMedia = false;
    let status = 'No music playing.';

    function setStatus(nextStatus) {
      status = String(nextStatus || '');
      if (typeof options.onStatus === 'function') options.onStatus(status, playing);
    }

    function setPlaying(value) {
      playing = !!value;
      if (typeof options.onPlayingChange === 'function') options.onPlayingChange(playing);
    }

    function applyVolume() {
      if (!player) return;
      try {
        const volume = Math.max(0, Math.min(100, Math.round(options.getVolume() * 100)));
        player.setVolume(volume);
        if (options.isMuted()) player.mute();
        else player.unMute();
      } catch (_) { }
    }

    function loadYoutubeApi() {
      if (root.YT && typeof root.YT.Player === 'function') return Promise.resolve(root.YT);
      if (youtubeApiPromise) return youtubeApiPromise;

      youtubeApiPromise = new Promise((resolve, reject) => {
        const previousReady = root.onYouTubeIframeAPIReady;
        root.onYouTubeIframeAPIReady = function () {
          try {
            if (typeof previousReady === 'function') previousReady();
          } catch (_) { }
          if (root.YT && typeof root.YT.Player === 'function') resolve(root.YT);
          else reject(new Error('YouTube player API did not initialize.'));
        };

        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.onerror = function () {
          youtubeApiPromise = null;
          reject(new Error('Could not load the YouTube player API.'));
        };
        document.head.appendChild(script);
      });

      return youtubeApiPromise;
    }

    function destroyPlayer() {
      request++;
      if (player) {
        try {
          player.stopVideo();
          player.destroy();
        } catch (_) { }
        player = null;
      }
      setPlaying(false);
    }

    function showIdle() {
      if (typeof options.showIdle === 'function') options.showIdle();
    }

    function releaseMedia() {
      if (options.hasMedia('recordPlayer')) options.releaseMedia('recordPlayer');
    }

    function stop() {
      destroyPlayer();
      queue = [];
      titles = [];
      index = 0;
      interrupted = null;
      interruptedByOtherMedia = false;
      releaseMedia();
      showIdle();
      setStatus('Playback stopped on the room TV.');
    }

    async function play(data, resume) {
      const ids = Array.isArray(data && data.queue)
        ? data.queue.filter(id => /^[A-Za-z0-9_-]{11}$/.test(String(id || '')))
        : [];

      if (!ids.length) {
        setStatus('No playable songs were supplied.');
        return;
      }

      if (!options.hasMedia('recordPlayer')) {
        if (!options.requestMedia('recordPlayer', 'Record player')) return;
        options.claimMedia('recordPlayer');
      }

      destroyPlayer();
      const playerRequest = request;
      queue = ids.slice();
      titles = Array.isArray(data.titles)
        ? data.titles.map(title => String(title || 'UNKNOWN SONG'))
        : [];
      index = resume ? Math.max(0, Math.min(queue.length - 1, resume.index || 0)) : 0;
      interrupted = null;

      try {
        const host = options.mount();
        if (!host) throw new Error('The television screen could not be mounted.');

        setStatus('Loading video on the room TV...');
        await loadYoutubeApi();
        if (playerRequest !== request) return;

        player = new root.YT.Player(host.id, {
          width: 400,
          height: 225,
          videoId: queue[index],
          playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: root.location.origin
          },
          events: {
            onReady: function (event) {
              if (playerRequest !== request) {
                try { event.target.destroy(); } catch (_) { }
                return;
              }

              const frame = event.target.getIframe && event.target.getIframe();
              if (frame) {
                frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
              }

              applyVolume();
              event.target.loadVideoById({
                videoId: queue[index],
                startSeconds: resume && resume.time > 0 ? resume.time : 0
              });
            },
            onStateChange: function (event) {
              if (playerRequest !== request) return;

              if (event.data === 1) {
                setPlaying(true);
                if (!options.hasMedia('recordPlayer')) {
                  if (options.requestMedia('recordPlayer', 'Record player')) {
                    options.claimMedia('recordPlayer');
                  } else {
                    try { event.target.pauseVideo(); } catch (_) { }
                    return;
                  }
                }
                setStatus('NOW PLAYING: ' + (titles[index] || 'UNKNOWN SONG'));
              } else if (event.data === 2) {
                setPlaying(false);
                releaseMedia();
                setStatus('PAUSED: ' + (titles[index] || 'UNKNOWN SONG'));
              } else if (event.data === 0) {
                index++;
                if (index < queue.length) {
                  setStatus('NOW PLAYING: ' + (titles[index] || 'UNKNOWN SONG'));
                  player.loadVideoById(queue[index]);
                } else {
                  setPlaying(false);
                  releaseMedia();
                  setStatus('Playlist finished.');
                }
              }
            },
            onError: function () {
              if (playerRequest !== request) return;
              setPlaying(false);
              releaseMedia();
              setStatus('This YouTube video cannot be played. Check its availability and embedding permissions.');
            }
          }
        });
      } catch (error) {
        if (playerRequest !== request) return;
        setPlaying(false);
        releaseMedia();
        setStatus(error && error.message ? error.message : 'Could not start the room TV player.');
      }
    }

    function pauseForOtherMedia() {
      if (queue.length) {
        interrupted = {
          queue: queue.slice(),
          titles: titles.slice(),
          index,
          time: Math.max(0, Number(player && player.getCurrentTime && player.getCurrentTime()) || 0)
        };
        interruptedByOtherMedia = true;
      }

      request++;
      if (player) {
        try { player.pauseVideo(); } catch (_) { }
      }
      setPlaying(false);
      if (queue.length) setStatus('PAUSED · ANOTHER ROOM MEDIA SOURCE IS PLAYING');
    }

    function discard() {
      interrupted = null;
      interruptedByOtherMedia = false;
      destroyPlayer();
      queue = [];
      titles = [];
      index = 0;
      showIdle();
      setStatus('Music playback was replaced by another room media source.');
    }

    function resume() {
      if (!interruptedByOtherMedia || !interrupted) return;
      const saved = interrupted;
      interrupted = null;
      interruptedByOtherMedia = false;
      play({ queue: saved.queue, titles: saved.titles }, saved);
    }

    return {
      play,
      stop,
      applyVolume,
      pauseForOtherMedia,
      discard,
      resume,
      hasQueue: function () { return queue.length > 0; },
      hasPlayer: function () { return !!player; },
      getStatus: function () { return status; },
      getPlaying: function () { return playing; }
    };
  }

  root.DanjoshiRoomTV = { create: createRoomTV };
})(window);
