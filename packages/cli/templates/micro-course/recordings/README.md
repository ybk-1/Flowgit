# 录制 / Recordings

一段录成一个文件，文件名就是段名（`s1`、`s2`……，见 `teleprompter.md`）：

- 录屏加讲解：`s1.mp4`（或 `.mov`、`.m4v`、`.webm`、`.mkv`）。视频用录屏的画面和声音。
- 只录声音：`s1.m4a`（或 `.mp3`、`.wav`、`.aac`、`.flac`、`.ogg`、`.opus`）。视频画幻灯片，配上这段声音。录屏和单独的声音都有时，用单独的声音。
- 你的字幕：`s1.srt` 或 `s1.vtt`，用转写工具（剪映、飞书妙记、Whisper 等）从录好的声音导出。有它就不再按讲稿切字幕，字幕就是你实际说的话。

录音小提示：选安静、软装多的房间，关掉空调和通知；嘴离麦克风一拳左右；每段开头和结尾留一两秒安静。生成视频时会把声音调到 -16 LUFS，不用自己调音量。

什么都不放也能往下走：没有录音的段会是无声的幻灯片视频，上架前检查会提醒你。

Record one file per segment, named after the segment (`s1`, `s2`, …; see `teleprompter.md`):

- A screen recording with your voice: `s1.mp4` (or `.mov`, `.m4v`, `.webm`, `.mkv`). The video uses its picture and sound.
- Audio only: `s1.m4a` (or `.mp3`, `.wav`, `.aac`, `.flac`, `.ogg`, `.opus`). The video draws the slides over it. With both a screen recording and a separate audio file, the audio file wins.
- Your captions: `s1.srt` or `s1.vtt`, exported from a transcription tool (Descript, Otter, Whisper and so on) from what you recorded. With it, the captions are what you actually said instead of being cut from the script.

Recording tips: a quiet room with soft furnishings, air conditioning and notifications off, the microphone about a fist's width from your mouth, and a second or two of silence at the start and end of each segment. The render stage sets the sound to -16 LUFS, so you don't need to adjust the level yourself.

The flow continues with nothing here: a segment with no recording becomes a silent slide video, and the pre-publish check reminds you.
