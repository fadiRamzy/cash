from PIL import Image, ImageDraw, ImageFont

def make_icon(size, path):
    img = Image.new("RGB", (size, size), (11, 31, 58))  # navy
    d = ImageDraw.Draw(img)
    pad = size * 0.12
    d.rounded_rectangle([pad, pad, size-pad, size-pad], radius=size*0.14, outline=(201,162,39), width=max(2,int(size*0.02)))
    font_size = int(size*0.42)
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    text = "AC"
    bbox = d.textbbox((0,0), text, font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    d.text(((size-tw)/2 - bbox[0], (size-th)/2 - bbox[1]), text, fill=(201,162,39), font=font)
    img.save(path)

make_icon(192, "assets/icons/icon-192.png")
make_icon(512, "assets/icons/icon-512.png")
print("done")
