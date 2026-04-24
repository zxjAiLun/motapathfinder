main.floors.MT348=
{
    "floorId": "MT348",
    "title": "348 层",
    "name": "348 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "03.png",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 2000000,
    "defaultGround": 906,
    "bgm": "20.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "var lastTime = core.getFlag('lastTime', 0);\n\nif (Date.now() - lastTime > 20) {\n\tvar image = core.material.images.images['03.png'];\n\tvar width = 416,\n\t\theight = 416;\n\n\tcore.canvas.bg.translate(width / 2, height / 2);\n\tcore.canvas.bg.rotate(Math.PI / 180 / 6);\n\tcore.canvas.bg.translate(-width / 2, -height / 2);\n\tcore.canvas.bg.drawImage(image, -288, -96);\n\n\tcore.setFlag('lastTime', Date.now());\n\n\tvar rotateTime = core.getFlag('rotateTime', 0);\n\trotateTime += 1;\n\tif (rotateTime >= 6 * 180) {\n\t\trotateTime -= 6 * 180;\n\t}\n\tcore.setFlag('rotateTime', rotateTime);\n}",
    "events": {},
    "changeFloor": {
        "11,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "1,11": {
            "floorId": ":next",
            "stair": "downFloor"
        },
        "6,7": {
            "floorId": "MT347",
            "loc": [
                4,
                11
            ]
        },
        "6,3": {
            "floorId": "MT349",
            "loc": [
                11,
                4
            ]
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [  4,621,  4,621,  4,173,173,173,  4,621,  4,621,  4],
    [  4,622,  4,622,  4,  0,902,  0,  4,622,  4,622,  4],
    [  4, 84,  4, 84,  4,621,  0,621,  4, 84,  4, 84,  4],
    [1035,640,1234, 86,620,  0,993,  0,620, 86,1234,642,1035],
    [1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035],
    [1035,642,1035,619, 82, 23,1035, 23,619,1035,1006,621,1035],
    [1035,621,1234,  0,1035,  0,1233,  0,1232, 83,622,639,1035],
    [1035,1035,1035,1035,1035,1035,992,1035,1035,1035,1035,1035,1035],
    [1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035],
    [1035,1035,635,1035,1035,1006,1035,638,1035,587,1035,579,1035],
    [1035,636,1234, 82,584,620,1035,1235,1035,1232,1035,1231,1035],
    [1035, 87,622,1035,  0,585,1233,  0, 15,620,  0, 88,1035],
    [1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035,1035]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}