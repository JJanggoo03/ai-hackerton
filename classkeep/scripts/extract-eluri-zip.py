import stat
import sys
from pathlib import Path, PurePosixPath
from zipfile import ZipFile


def main() -> int:
    if len(sys.argv) != 3:
        print("사용법: extract-eluri-zip.py <zip> <출력 폴더>", file=sys.stderr)
        return 2

    source = Path(sys.argv[1])
    destination = Path(sys.argv[2]).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    total = 0
    count = 0
    max_files = 1000
    max_total = 800 * 1024 * 1024

    with ZipFile(source) as archive:
        for info in archive.infolist():
            name = info.filename.replace("\\", "/")
            relative = PurePosixPath(name)
            mode = info.external_attr >> 16
            if relative.is_absolute() or any(part in ("", ".", "..") for part in relative.parts):
                raise ValueError("ZIP 안에 허용되지 않는 경로가 있습니다.")
            if stat.S_ISLNK(mode):
                raise ValueError("ZIP 안의 바로가기 파일은 처리하지 않습니다.")
            if info.is_dir():
                continue
            if info.file_size > 90 * 1024 * 1024:
                raise ValueError(f"GitHub 단일 파일 한도에 가까운 파일이 있어 업로드를 중단했습니다: {relative.name}")
            if count + 1 > max_files or total + info.file_size > max_total:
                raise ValueError("ZIP 안의 파일 수 또는 전체 압축 해제 용량이 허용 한도를 넘었습니다.")
            target = (destination / Path(*relative.parts)).resolve()
            if destination not in target.parents:
                raise ValueError("ZIP 경로가 출력 폴더 밖을 가리킵니다.")
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as incoming, target.open("xb") as outgoing:
                while chunk := incoming.read(1024 * 1024):
                    outgoing.write(chunk)
            total += info.file_size
            count += 1

    if count == 0:
        raise ValueError("ZIP 안에 업로드할 파일이 없습니다.")
    print(f"{count}\t{total}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
