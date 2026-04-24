main.floors.MT158=
{
    "floorId": "MT158",
    "title": "158 层",
    "name": "158 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "02.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 2000,
    "defaultGround": 906,
    "bgm": "11.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "1,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,9": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {
        "1,10": [
            "\t[探险者们]杀啊！冲！杀！",
            "\t[纳可]……怪不得到处都是血腥气息。\n这里已经化为了一片残酷的战场。",
            "\t[纳可]前面到底发生了什么事情，\n怎么会有如此大规模的战斗发生？",
            {
                "type": "hide",
                "loc": [
                    [
                        2,
                        6
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        1,
                        7
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        2,
                        8
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        3,
                        9
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        5,
                        6
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        4,
                        7
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        5,
                        8
                    ]
                ],
                "remove": true
            }
        ]
    },
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [918,918,918,918,918,918,918,918,918,918,918,918,918],
    [918, 21, 21, 21,918,918,584, 21, 21,585, 82, 60,918],
    [918,918, 82,918,918,918,918,436,918,918,918, 82,918],
    [918, 21, 21, 82,576,918,918, 81,918,577, 81,432,918],
    [918,918, 21,918,  0,437,586,  0,572,433,918, 22,918],
    [918,918,918,918,918,918,918,432,918,918,918, 82,918],
    [918,  0,443,  0,  0,428,918, 58,  0,918, 21, 60,918],
    [918,430,  0,  0,434,  0,918,  0, 59, 82, 60,918,918],
    [918,  0,422,  0,  0,428,918,918, 81,918, 81,918,918],
    [918,  0,  0,422,  0,  0, 86,438,  0,918,434, 87,918],
    [918, 86,  0,  0,  0,  0,918,  0,579,918,584, 82,918],
    [918, 88,918,918,918,918,918,918,437, 21, 82,918,918],
    [918,918,918,918,918,918,918,918,918,918,918,918,918]
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