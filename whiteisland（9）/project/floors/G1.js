main.floors.G1=
{
    "floorId": "G1",
    "title": "逃生舱",
    "name": "逃生舱",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": 970,
    "bgm": "2.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "1,0": [
            {
                "type": "choices",
                "text": "可以选择在这里降低难度。\n你将得到10%伤害减免，以及本区域额外福利：\n2攻击。",
                "choices": [
                    {
                        "text": "降低难度",
                        "color": [
                            0,
                            255,
                            125,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "item:I582",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:atk",
                                "operator": "+=",
                                "value": "2"
                            },
                            {
                                "type": "hide",
                                "remove": true
                            }
                        ]
                    },
                    {
                        "text": "取消",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "2,10": {
            "floorId": ":next",
            "stair": "downFloor"
        },
        "7,10": {
            "floorId": "G1",
            "loc": [
                5,
                1
            ]
        },
        "5,1": {
            "floorId": "G1",
            "loc": [
                7,
                10
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
    [142, 89,142,142,142,142,142,142,142,142,142,142,142],
    [142,  0,142, 34,142,104,  0,242, 82, 29,  0,577,142],
    [142,201,142,  0,142,142,210,142,142,142,142,265,142],
    [142,576,  0, 21, 82, 32,  0, 21, 82,201,  0, 22,142],
    [142,142, 81,142,142,142,142,142,142,142,142,240,142],
    [142, 28,  0,201, 82,  0, 22,  0,210, 32,  0, 27,142],
    [142,  0, 22,  0,142, 31,  0, 28,142,  0,242,  0,142],
    [142,142, 86,142,142,142,243,142,142,142, 81,142,142],
    [142,210,  0,210, 34,142,  0, 81, 21,  0, 29,239,142],
    [142,  0, 82,142,142,142,243,142,142,210,142, 81,142],
    [142,239, 87,  0, 47, 81,  0,104,142,  0,240,  0,142],
    [142,142,  0, 31,  0,142, 27,  0,142, 21,142, 27,142],
    [142,142,142,142,142,142,142,142,142,142,142,142,142]
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