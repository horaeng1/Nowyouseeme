import os
import logging

# pytubefix 사용 (yt-dlp는 YouTube 보안 강화로 현재 작동 안함 - 2024.12)
USE_PYTUBEFIX = True
USE_YTDLP_FALLBACK = False  # yt-dlp 폴백 비활성화 (필요시 True로 변경)

def download_with_pytubefix(url, output_dir):
    """pytubefix를 사용한 YouTube 다운로드"""
    try:
        from pytubefix import YouTube
        from http.cookiejar import MozillaCookieJar
        
        logging.info(f"[pytubefix] Downloading: {url}")
        
        # 쿠키 파일 로드 (봇 탐지 우회)
        cookie_file = os.path.join(os.path.dirname(__file__), 'www.youtube.com_cookies.txt')
        cookies = None
        if os.path.exists(cookie_file):
            try:
                cj = MozillaCookieJar(cookie_file)
                cj.load(ignore_discard=True, ignore_expires=True)
                cookies = cj
                logging.info(f"[pytubefix] Loaded cookies from: {cookie_file}")
            except Exception as e:
                logging.warning(f"[pytubefix] Failed to load cookies: {e}")
        
        # 진행 콜백 제거 (Windows cp949 인코딩 오류 방지)
        yt = YouTube(url, cookies=cookies) if cookies else YouTube(url)
        
        # 가장 높은 해상도의 프로그레시브 스트림 선택 (영상+오디오 합쳐진 것)
        stream = yt.streams.filter(progressive=True, file_extension='mp4').order_by('resolution').desc().first()
        
        if not stream:
            # 프로그레시브 스트림이 없으면 비디오만 다운로드
            stream = yt.streams.filter(file_extension='mp4').order_by('resolution').desc().first()
        
        if not stream:
            raise Exception("No suitable video stream found")
        
        logging.info(f"[pytubefix] Selected stream: {stream.resolution}")
        
        # 파일명을 video_id.mp4로 설정
        filename = f"{yt.video_id}.mp4"
        filepath = stream.download(output_path=output_dir, filename=filename)
        
        logging.info(f"[pytubefix] Download complete: {filepath}")
        
        return {
            'status': 'success',
            'filename': filename,
            'path': filepath,
            'title': yt.title,
            'duration': yt.length,
            'videoId': yt.video_id,
            'sourceUrl': url
        }
        
    except Exception as e:
        logging.error(f"[pytubefix] Download failed: {str(e)}")
        raise e


def download_with_ytdlp(url, output_dir):
    """yt-dlp를 사용한 YouTube 다운로드 (폴백)"""
    import yt_dlp
    
    cookie_file = os.path.join(os.path.dirname(__file__), 'www.youtube.com_cookies.txt')
    
    ydl_opts = {
        'format': 'best[ext=mp4]/best',
        'outtmpl': os.path.join(output_dir, '%(id)s.%(ext)s'),
        'quiet': False,
        'no_warnings': False,
        'overwrites': True,
        'cookiefile': cookie_file if os.path.exists(cookie_file) else None,
        'extractor_args': {'youtube': {'player_client': ['ios', 'android', 'web']}},
        'socket_timeout': 30,
        'retries': 3,
    }
    
    logging.info(f"[yt-dlp] Downloading: {url}")
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        filename = ydl.prepare_filename(info)
        
        return {
            'status': 'success',
            'filename': os.path.basename(filename),
            'path': filename,
            'title': info.get('title', 'Unknown Title'),
            'duration': info.get('duration', 0),
            'videoId': info.get('id', ''),
            'sourceUrl': url
        }


def download_youtube_video(url, output_dir):
    """
    Downloads a YouTube video using pytubefix (primary) or yt-dlp (fallback).
    
    Args:
        url (str): YouTube video URL
        output_dir (str): Directory to save the downloaded video
        
    Returns:
        dict: Metadata of the downloaded video (filename, title, duration, etc.)
    """
    os.makedirs(output_dir, exist_ok=True)
    
    # 1. pytubefix 시도 (기본)
    if USE_PYTUBEFIX:
        try:
            return download_with_pytubefix(url, output_dir)
        except ImportError:
            logging.warning("[pytubefix] Not installed")
            if not USE_YTDLP_FALLBACK:
                return {'status': 'error', 'message': 'pytubefix not installed'}
        except Exception as e:
            logging.warning(f"[pytubefix] Failed: {e}")
            if not USE_YTDLP_FALLBACK:
                return {'status': 'error', 'message': str(e)}
    
    # 2. yt-dlp 폴백 (비활성화됨 - YouTube 보안 강화로 현재 작동 안함)
    if USE_YTDLP_FALLBACK:
        try:
            return download_with_ytdlp(url, output_dir)
        except Exception as e:
            logging.error(f"[yt-dlp] Download failed: {str(e)}")
            return {
                'status': 'error',
                'message': str(e)
            }
    
    return {'status': 'error', 'message': 'No download method available'}


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) > 2:
        url = sys.argv[1]
        output_dir = sys.argv[2]
        result = download_youtube_video(url, output_dir)
        print(result)
    else:
        print("Usage: python download_youtube.py <url> <output_dir>")
